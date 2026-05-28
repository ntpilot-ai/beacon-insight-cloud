/**
 * Term-bounded pulse — fetch helpers.
 *
 * The engine itself stays pure (lib/pulse_engine_v3.ts); these helpers wrap
 * the Supabase reads that callers (Pulse page, triage API, verify script)
 * need to assemble a TermContext.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SchoolTerm,
  PulseTermSnapshot,
  TermContext,
} from "./pulse_engine_v3";

/**
 * Find the school term that contains `on` (defaults to today).
 *
 * Returns null when no term covers the date — e.g. mid-holiday before the
 * next term has been seeded, or a school that hasn't completed setup.
 * Callers should fall back to unbounded engine behaviour in that case.
 */
export async function fetchCurrentTerm(
  supabase: SupabaseClient,
  schoolId: string,
  on: Date = new Date(),
): Promise<SchoolTerm | null> {
  const iso = on.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("school_terms")
    .select("*")
    .eq("school_id", schoolId)
    .lte("start_date", iso)
    .gte("end_date", iso)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[terms] fetchCurrentTerm failed:", error.message);
    return null;
  }
  return (data as SchoolTerm | null) ?? null;
}

/**
 * Find the term immediately preceding `currentTerm` (highest end_date
 * strictly before currentTerm.start_date). Returns null when none exists
 * (first term of the year, or a fresh school).
 */
export async function fetchPreviousTerm(
  supabase: SupabaseClient,
  schoolId: string,
  currentTerm: SchoolTerm,
): Promise<SchoolTerm | null> {
  const { data, error } = await supabase
    .from("school_terms")
    .select("*")
    .eq("school_id", schoolId)
    .lt("end_date", currentTerm.start_date)
    .order("end_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[terms] previous-term lookup failed:", error.message);
    return null;
  }
  return (data as SchoolTerm | null) ?? null;
}

/**
 * Fetch the snapshot row for each student from `previousTerm`. Used to
 * drive cross-term re_emergence and the Phase 4 carry-over UI.
 *
 * Returns [] (not null) when no rows exist for that term. The engine treats
 * missing snapshots as "no carry-over".
 */
export async function fetchPreviousTermSnapshots(
  supabase: SupabaseClient,
  schoolId: string,
  previousTerm: SchoolTerm,
): Promise<PulseTermSnapshot[]> {
  const { data, error } = await supabase
    .from("pulse_term_snapshots")
    .select("*")
    .eq("school_id", schoolId)
    .eq("term_id", previousTerm.term_id);
  if (error) {
    console.warn("[terms] snapshot fetch failed:", error.message);
    return [];
  }
  return (data as PulseTermSnapshot[] | null) ?? [];
}

/**
 * Convenience: build a TermContext in one shot. Returns null when no current
 * term exists for the school — caller passes undefined to the engine and gets
 * the legacy unbounded behaviour. previousTerm and previousTermSnapshots are
 * populated whenever a prior term exists in school_terms.
 */
export async function fetchTermContext(
  supabase: SupabaseClient,
  schoolId: string,
  on: Date = new Date(),
): Promise<TermContext | null> {
  const currentTerm = await fetchCurrentTerm(supabase, schoolId, on);
  if (!currentTerm) return null;

  const previousTerm = await fetchPreviousTerm(supabase, schoolId, currentTerm);
  const previousTermSnapshots = previousTerm
    ? await fetchPreviousTermSnapshots(supabase, schoolId, previousTerm)
    : [];

  return { currentTerm, previousTerm, previousTermSnapshots };
}

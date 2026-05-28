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
 * Fetch the snapshot row for each student from the term immediately preceding
 * `currentTerm`. Used to drive cross-term re_emergence.
 *
 * Returns [] (not null) when no prior term exists — first term of the year,
 * or a fresh school. The engine treats missing snapshots as "no carry-over".
 */
export async function fetchPreviousTermSnapshots(
  supabase: SupabaseClient,
  schoolId: string,
  currentTerm: SchoolTerm,
): Promise<PulseTermSnapshot[]> {
  // Previous term = highest end_date strictly before this term's start_date.
  const { data: priorTerm, error: termErr } = await supabase
    .from("school_terms")
    .select("term_id")
    .eq("school_id", schoolId)
    .lt("end_date", currentTerm.start_date)
    .order("end_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (termErr) {
    console.warn("[terms] previous-term lookup failed:", termErr.message);
    return [];
  }
  if (!priorTerm) return [];

  const { data, error } = await supabase
    .from("pulse_term_snapshots")
    .select("*")
    .eq("school_id", schoolId)
    .eq("term_id", (priorTerm as { term_id: string }).term_id);

  if (error) {
    console.warn("[terms] snapshot fetch failed:", error.message);
    return [];
  }
  return (data as PulseTermSnapshot[] | null) ?? [];
}

/**
 * Convenience: build a TermContext in one shot. Returns null when no current
 * term exists for the school — caller passes undefined to the engine and gets
 * the legacy unbounded behaviour.
 */
export async function fetchTermContext(
  supabase: SupabaseClient,
  schoolId: string,
  on: Date = new Date(),
): Promise<TermContext | null> {
  const currentTerm = await fetchCurrentTerm(supabase, schoolId, on);
  if (!currentTerm) return null;
  const previousTermSnapshots = await fetchPreviousTermSnapshots(
    supabase, schoolId, currentTerm,
  );
  return { currentTerm, previousTermSnapshots };
}

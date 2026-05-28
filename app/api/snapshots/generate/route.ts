import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  calculateAllPulsesV3,
  type BeaconEvent,
  type PulseAcknowledgement,
  type SchoolTerm,
} from "@/lib/pulse_engine_v3";
import { computeTermSnapshot } from "@/lib/snapshot";

/**
 * POST /api/snapshots/generate
 *
 * Phase 3 of term-bounded pulse. For each student with ≥1 event in the
 * target term, computes a pulse_term_snapshots row representing their
 * locked end-of-term state.
 *
 * Body:
 *   {
 *     requested_by: string,
 *     school_id?:   string,  // defaults to env NEXT_PUBLIC_SCHOOL_ID
 *     term_id?:     string,  // defaults to the most-recently-ended term
 *     force?:       boolean  // re-generate rows that already exist
 *   }
 *
 * Idempotent under repeat calls: an existing (school, student, term)
 * snapshot is skipped unless force=true, in which case it's upserted.
 *
 * Intended cron use: fire once shortly after each term ends. Manual call
 * is supported for backfill (any past term) and override.
 */

const PAGE_SIZE = 1000;
const DAY_MS    = 86400000;

export async function POST(req: NextRequest) {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supaUrl || !supaKey) {
    return NextResponse.json({ error: "Required env vars not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const requested_by = String(body?.requested_by || "").slice(0, 200);
  const school_id    = String(body?.school_id || process.env.NEXT_PUBLIC_SCHOOL_ID || "beacon-academy");
  const term_id      = body?.term_id ? String(body.term_id) : null;
  const force        = !!body?.force;

  if (!requested_by) {
    return NextResponse.json({ error: "requested_by is required" }, { status: 400 });
  }

  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // ── Resolve target term ──
  const term = term_id
    ? await fetchTerm(supabase, school_id, term_id)
    : await fetchMostRecentlyEndedTerm(supabase, school_id);
  if (!term) {
    return NextResponse.json(
      { error: term_id ? `term ${term_id} not found` : "no completed terms for school" },
      { status: 404 },
    );
  }

  // engineNow = day after term_end so the engine's last-24h window is the
  // final day of the term itself. Future-end terms (i.e. snapshotting a term
  // that hasn't ended yet — backfill or manual override use case) get
  // clamped to actual now so we don't pretend events exist that don't.
  const termEndMs    = new Date(term.end_date + "T00:00:00Z").getTime() + DAY_MS;
  const engineNowMs  = Math.min(termEndMs, Date.now());

  // ── Fetch term-bounded data ──
  const [events, acks, existing] = await Promise.all([
    fetchTermEvents(supabase, school_id, term),
    fetchTermAcks(supabase, school_id, term),
    fetchExistingSnapshots(supabase, school_id, term.term_id),
  ]);

  if (events.length === 0) {
    return NextResponse.json({
      status:    "ok",
      term_id:   term.term_id,
      generated: 0,
      skipped:   0,
      note:      "no events in term",
    });
  }

  // ── Run engine as-of term_end ──
  // termContext is intentionally NOT passed: events are already term-scoped
  // by the SQL query, so a second engine-level filter would be redundant.
  // engineNowMs anchors the recency/L3 windows to the term-end moment.
  const pulses = calculateAllPulsesV3(events, acks, [], undefined, engineNowMs);
  const pulseByStudent = new Map(pulses.map(p => [p.student_id, p]));

  // Group events + acks by student for per-snapshot composition.
  const eventsByStudent: Record<string, BeaconEvent[]> = {};
  events.forEach(e => {
    if (!eventsByStudent[e.student_id]) eventsByStudent[e.student_id] = [];
    eventsByStudent[e.student_id].push(e);
  });
  const acksByStudent: Record<string, PulseAcknowledgement[]> = {};
  acks.forEach(a => {
    if (!acksByStudent[a.student_id]) acksByStudent[a.student_id] = [];
    acksByStudent[a.student_id].push(a);
  });

  const existingStudents = new Set(existing.map(s => s.student_id));

  // ── Compose + upsert ──
  let generated = 0;
  let skipped   = 0;
  const failures: { student_id: string; error: string }[] = [];

  for (const studentId of Object.keys(eventsByStudent)) {
    if (!force && existingStudents.has(studentId)) { skipped++; continue; }
    const pulse = pulseByStudent.get(studentId);
    if (!pulse) { skipped++; continue; }

    try {
      const snapshot = computeTermSnapshot(
        studentId,
        eventsByStudent[studentId],
        acksByStudent[studentId] ?? [],
        term,
        pulse,
      );
      const { error } = await supabase
        .from("pulse_term_snapshots")
        .upsert(snapshot, { onConflict: "school_id,student_id,term_id" });
      if (error) {
        failures.push({ student_id: studentId, error: error.message });
      } else {
        generated++;
      }
    } catch (e: any) {
      failures.push({ student_id: studentId, error: String(e?.message ?? e).slice(0, 300) });
    }
  }

  return NextResponse.json({
    status:       "ok",
    term_id:      term.term_id,
    term_window:  { start: term.start_date, end: term.end_date },
    students:     Object.keys(eventsByStudent).length,
    generated,
    skipped,
    failures,
    requested_by,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Match the convention used in the sibling triage/run route — Supabase's
// generated client type doesn't widen cleanly through helper boundaries.
type SB = any;

async function fetchTerm(supabase: SB, school_id: string, term_id: string): Promise<SchoolTerm | null> {
  const { data } = await supabase
    .from("school_terms")
    .select("*")
    .eq("school_id", school_id)
    .eq("term_id", term_id)
    .maybeSingle();
  return (data as SchoolTerm | null) ?? null;
}

async function fetchMostRecentlyEndedTerm(supabase: SB, school_id: string): Promise<SchoolTerm | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("school_terms")
    .select("*")
    .eq("school_id", school_id)
    .lt("end_date", today)
    .order("end_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SchoolTerm | null) ?? null;
}

async function fetchTermEvents(supabase: SB, school_id: string, term: SchoolTerm): Promise<BeaconEvent[]> {
  // Paginate around PostgREST's 1000-row default cap, same pattern as
  // lib/fetchEvents.ts uses elsewhere in the project.
  const all: BeaconEvent[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("beacon_events")
      .select("*")
      .eq("school_id", school_id)
      .gte("created_at", term.start_date + "T00:00:00Z")
      .lt("created_at", endOfDayPlusOne(term.end_date))
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetchTermEvents: ${error.message}`);
    const page = (data as BeaconEvent[] | null) ?? [];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

async function fetchTermAcks(supabase: SB, school_id: string, term: SchoolTerm): Promise<PulseAcknowledgement[]> {
  const { data, error } = await supabase
    .from("pulse_acknowledgements")
    .select("*")
    .eq("school_id", school_id)
    .gte("acknowledged_at", term.start_date + "T00:00:00Z")
    .lt("acknowledged_at", endOfDayPlusOne(term.end_date));
  if (error) throw new Error(`fetchTermAcks: ${error.message}`);
  return (data as PulseAcknowledgement[] | null) ?? [];
}

async function fetchExistingSnapshots(supabase: SB, school_id: string, term_id: string): Promise<{ student_id: string }[]> {
  const { data } = await supabase
    .from("pulse_term_snapshots")
    .select("student_id")
    .eq("school_id", school_id)
    .eq("term_id", term_id);
  return (data as { student_id: string }[] | null) ?? [];
}

function endOfDayPlusOne(yyyyMmDd: string): string {
  const t = new Date(yyyyMmDd + "T00:00:00Z").getTime() + DAY_MS;
  return new Date(t).toISOString();
}

/**
 * Term-bounded pulse — snapshot computation (Phase 3).
 *
 * Pure function that turns a student's term-bounded data into the row
 * shape stored in pulse_term_snapshots. Schema and field meanings are
 * defined in supabase/sql/0011_term_bounded_pulse.sql.
 *
 * The engine remains the single source of truth for the *score*: we run
 * calculateAllPulsesV3 with engineNowMs = term_end + 1d in the caller, and
 * pass the resulting StudentPulseV3 in here. Everything else in the snapshot
 * (opening level, trajectory, ack counts, key incidents, layer-3 day count)
 * is computed directly from the same term-bounded events the engine saw.
 */

import {
  clusterCategories,
  type BeaconEvent,
  type PulseAcknowledgement,
  type SchoolTerm,
  type StudentPulseV3,
  type PulseTermSnapshot,
  type PulseTermSnapshotIncident,
} from "./pulse_engine_v3";

const DAY_MS = 86400000;

// How wide the opening-week window is. Short enough to read as "start of
// term", long enough to give the bucket some signal.
const OPENING_WINDOW_DAYS = 7;

// At/above this many Layer-3 days within a term, trajectory is 'volatile'
// regardless of opening→final delta.
const VOLATILE_LAYER3_DAYS = 3;

type AlertLevel = "critical" | "high" | "medium" | "low" | "normal";

// ── Helpers ───────────────────────────────────────────────────────────────────

function ts(s: string): number { return new Date(s).getTime(); }

function bandFromScore(score: number): AlertLevel {
  if (score >= 70) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

/**
 * Same weighted-baseline calculation as the v3 engine's fingerprint. Lifted
 * here (rather than re-imported) because the engine doesn't export it and we
 * only need the scalar score, not the whole fingerprint object.
 */
function scoreEvents(events: BeaconEvent[]): number {
  if (!events.length) return 0;
  let high = 0, medium = 0;
  events.forEach(e => {
    if (e.risk === "high" || e.risk === "critical") high++;
    else if (e.risk === "medium") medium++;
  });
  const low = events.length - high - medium;
  return Math.min(100, Math.round((high * 75 + medium * 40 + low * 5) / events.length));
}

/**
 * Opening alert level = the band the student presented at in the first
 * OPENING_WINDOW_DAYS of the term. Coarse but useful as a trajectory anchor.
 * Empty opening week → "low" (the floor, not a missing-data signal).
 */
function computeOpeningAlertLevel(termEvents: BeaconEvent[], term: SchoolTerm): AlertLevel {
  const termStartMs = ts(term.start_date + "T00:00:00Z");
  const openingEnd  = termStartMs + OPENING_WINDOW_DAYS * DAY_MS;
  const opening = termEvents.filter(e => {
    const t = ts(e.created_at);
    return t >= termStartMs && t < openingEnd;
  });
  return bandFromScore(scoreEvents(opening));
}

/**
 * Peak alert level = highest band reached in any rolling 7-day window across
 * the term. Captures "this student had a concerning period" even if the
 * engine's term-end snapshot looks calm. Cross-term re_emergence and the
 * Phase 4 carry-over filter both gate on this.
 *
 * Implementation: step by day across the term, scoring the trailing 7 days
 * at each step, take the max band. Cheap (term length × O(events)) and
 * matches the engine's near-term window concept.
 */
function computePeakAlertLevel(termEvents: BeaconEvent[], term: SchoolTerm): AlertLevel {
  if (!termEvents.length) return "low";

  const termStartMs = ts(term.start_date + "T00:00:00Z");
  const termEndMs   = ts(term.end_date   + "T00:00:00Z") + DAY_MS;

  // Pre-sort once so window slicing stays cheap.
  const sorted = [...termEvents].sort((a, b) => ts(a.created_at) - ts(b.created_at));
  const tsArray = sorted.map(e => ts(e.created_at));

  const bandOrder: Record<AlertLevel, number> = { low: 0, normal: 0, medium: 1, high: 2, critical: 3 };
  let peakBand: AlertLevel = "low";

  // Step day-by-day from term_start through term_end. At each day boundary
  // d, score the events in the trailing 7 days [d-7d, d). Stops as soon as
  // peak hits 'critical' — can't get higher.
  for (let d = termStartMs + DAY_MS; d <= termEndMs; d += DAY_MS) {
    const windowStart = d - OPENING_WINDOW_DAYS * DAY_MS;
    const inWindow: BeaconEvent[] = [];
    for (let i = 0; i < tsArray.length; i++) {
      if (tsArray[i] >= windowStart && tsArray[i] < d) inWindow.push(sorted[i]);
    }
    if (!inWindow.length) continue;
    const band = bandFromScore(scoreEvents(inWindow));
    if (bandOrder[band] > bandOrder[peakBand]) peakBand = band;
    if (peakBand === "critical") break;
  }
  return peakBand;
}

/**
 * Count of days in the term where Layer-3 conditions would have fired.
 * Approximation: per-calendar-day bucket, no rolling 24h window. Matches
 * the engine's L3 condition shape (≥3 flagged OR ≥2 flagged with ≥1 high).
 */
function countLayer3Days(termEvents: BeaconEvent[]): number {
  const byDay: Record<string, { flagged: number; highOrCrit: number }> = {};
  termEvents.forEach(e => {
    if (e.risk === "low") return;
    const day = new Date(e.created_at).toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { flagged: 0, highOrCrit: 0 };
    byDay[day].flagged++;
    if (e.risk === "high" || e.risk === "critical") byDay[day].highOrCrit++;
  });
  let count = 0;
  Object.values(byDay).forEach(b => {
    if (b.flagged >= 3 || (b.highOrCrit >= 1 && b.flagged >= 2)) count++;
  });
  return count;
}

/**
 * Trajectory classifier. Returns one of:
 *   volatile             — significant Layer-3 activity regardless of delta
 *   resolved_after_peak  — peaked at high+ but closed below peak (the
 *                          "Aisha pattern": tough term that calmed by end)
 *   improving            — final band lower than opening
 *   worsening            — final band higher than opening
 *   stable               — same band, no peak
 *
 * Phase C of the detail-panel plan introduces a richer trajectory vocabulary
 * (sustained_improvement / cyclical / etc.); when that lands the snapshot
 * schema's open `trajectory text` column can absorb it without migration.
 */
function classifyTrajectory(
  opening:    AlertLevel,
  final:      AlertLevel,
  peak:       AlertLevel,
  layer3Days: number,
): string {
  if (layer3Days >= VOLATILE_LAYER3_DAYS) return "volatile";
  const order: Record<AlertLevel, number> = { low: 0, normal: 0, medium: 1, high: 2, critical: 3 };
  const o = order[opening];
  const f = order[final];
  const p = order[peak];
  if (p >= order.high && p > f) return "resolved_after_peak";
  if (f < o) return "improving";
  if (f > o) return "worsening";
  return "stable";
}

/**
 * Top 3 high/critical events from the term, most-recent first. Embedded in
 * the snapshot as jsonb so it survives Phase-5 raw-event pruning — the
 * snapshot stays interpretable after the underlying beacon_events are gone.
 *
 * Prompt is truncated; full text remains in beacon_events until retention
 * deletes it. PII handling on the prompt body is a Phase-5 compliance
 * concern, not solved here.
 */
function pickKeyIncidents(termEvents: BeaconEvent[]): PulseTermSnapshotIncident[] {
  const flagged = termEvents.filter(e => e.risk === "high" || e.risk === "critical");
  flagged.sort((a, b) => ts(b.created_at) - ts(a.created_at));
  return flagged.slice(0, 3).map(e => ({
    timestamp:  e.created_at,
    summary:    (e.prompt || "").slice(0, 200),
    category:   clusterCategories([e])[0]?.name ?? "General",
    risk_level: e.risk,
  }));
}

// ── Public ────────────────────────────────────────────────────────────────────

/**
 * Compose a snapshot row for one student-term.
 *
 * Caller is responsible for:
 *   - Filtering termEvents and termAcks to (student, term) before calling
 *   - Producing finalPulse by running calculateAllPulsesV3 with
 *     engineNowMs = term_end + 1d and a termContext for `term`
 */
export function computeTermSnapshot(
  studentId:  string,
  termEvents: BeaconEvent[],
  termAcks:   PulseAcknowledgement[],
  term:       SchoolTerm,
  finalPulse: StudentPulseV3,
): PulseTermSnapshot {
  const opening = computeOpeningAlertLevel(termEvents, term);
  const final   = finalPulse.alert_level as AlertLevel;
  const peak    = computePeakAlertLevel(termEvents, term);
  const l3Days  = countLayer3Days(termEvents);

  // dominant_categories: prefer the engine's fingerprint categories (already
  // top-3, deduped); fall back to a fresh cluster if the engine had no
  // historical window (e.g. very short term).
  const dominant = finalPulse.fingerprint.dominant_categories.length > 0
    ? finalPulse.fingerprint.dominant_categories
    : clusterCategories(termEvents).slice(0, 3).map(c => c.name);

  const referrals = termAcks.filter(a =>
    a.action_taken === "referred" || a.action_taken === "escalated"
  ).length;

  return {
    school_id:           term.school_id,
    student_id:          studentId,
    term_id:             term.term_id,
    term_start:          term.start_date,
    term_end:            term.end_date,
    locked_at:           new Date().toISOString(),

    final_score:         finalPulse.pulse_score,
    final_alert_level:   final,
    opening_alert_level: opening,
    peak_alert_level:    peak,
    trajectory:          classifyTrajectory(opening, final, peak, l3Days),

    dominant_categories: dominant,
    pattern:             finalPulse.fingerprint.pattern,

    ack_count:           termAcks.length,
    referral_count:      referrals,
    layer3_event_days:   l3Days,

    key_incidents:       pickKeyIncidents(termEvents),
    total_events:        termEvents.length,
    flagged_events:      termEvents.filter(e => e.risk !== "low").length,
  };
}

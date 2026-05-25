// Weekly summary for pastoral lead / DSL — Phase 3 step 14.
//
// Pure aggregator: takes the same data the queue already has (pulses, triage
// rows, acks, events) and rolls it up into a structured Monday-style digest.
// No DB writes, no LLM calls — every metric is rule-based aggregation over
// the inputs. The UI renders the result inside a card on the Today's Queue
// view; auto-opens on Mondays, collapsed otherwise.
//
// "Improvement" detection uses the trend slice (last-7-days avg vs prior-7-
// days avg per student), then derives an alert tier from each half and flags
// students who dropped a tier. This avoids needing historical pulse snapshots.

import type { BeaconEvent, StudentPulseV3, PulseAcknowledgement } from "./pulse_engine_v3";

export type TriageLevelLike = "silent_monitoring" | "low" | "medium" | "high" | "urgent";
export type AlertLevel      = "critical" | "high" | "medium" | "low";

interface TriageRowLike {
  student_id:         string;
  assessed_at:        string;
  triage:             TriageLevelLike;
  notify_immediately: boolean;
}

export interface WeeklySummary {
  week_start:  string;   // ISO Monday date 00:00 UTC
  week_end:    string;   // ISO Sunday date 23:59 UTC
  week_label:  string;   // "19 May – 25 May 2026"
  is_monday:   boolean;  // hint for the UI's default-open behaviour

  // Students who hit the actionable queue at least once this week (any
  // triage level above silent_monitoring on any day). Sorted by highest
  // triage seen, then by how many days they appeared.
  attention_students: {
    student_id:     string;
    highest_triage: TriageLevelLike;
    days_in_queue:  number;
    notify_count:   number;
  }[];

  // Re-emergences currently flagged on the live pulse computation.
  re_emergence_students: string[];

  // Improvements: students whose recent-week trend avg is at least a tier
  // below their prior-week trend avg.
  improvement_students: {
    student_id: string;
    from:       AlertLevel;
    to:         AlertLevel;
  }[];

  // Regressions: same logic in reverse — useful counterpart so the digest
  // isn't only good news.
  regression_students: {
    student_id: string;
    from:       AlertLevel;
    to:         AlertLevel;
  }[];

  // School trend (avg pulse score across all students with activity).
  school_avg_this_week:  number;
  school_avg_last_week:  number;
  school_avg_delta:      number;

  // Acknowledgements logged in the week, broken down by action_taken.
  acks_this_week: {
    total:     number;
    monitored: number;
    referred:  number;
    escalated: number;
    no_action: number;
  };

  // Top categories from flagged events this week.
  top_categories: { name: string; count: number }[];

  // Engagement deltas vs prior week.
  events_this_week:          number;
  events_last_week:          number;
  active_students_this_week: number;
}

const DAY_MS = 86400000;

// Start of the most recent Monday at 00:00 UTC. Spec calls for Monday-as-
// week-start (pastoral teams in UK secondary schools work on this rhythm).
export function lastMondayUtcStart(now: number = Date.now()): number {
  const d   = new Date(now);
  const dow = (d.getUTCDay() + 6) % 7;  // Mon=0, Sun=6
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow));
  return monday.getTime();
}

function fmtDayMonth(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fmtDayMonthYear(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Derive an alert tier from a raw score using the same thresholds as the
// engine itself (critical >=70, high >=50, medium >=25, else low).
function tierForScore(score: number): AlertLevel {
  if (score >= 70) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

const TIER_ORDER: Record<AlertLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const TRIAGE_ORDER: Record<TriageLevelLike, number> = {
  silent_monitoring: 0, low: 1, medium: 2, high: 3, urgent: 4,
};

function avg(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function clusterCategoriesFromEvents(events: BeaconEvent[]): { name: string; count: number }[] {
  const counts: Record<string, number> = {};
  events.filter(e => e.risk !== "low").forEach(e => {
    const m = (e.matched || []).join(" ").toLowerCase();
    let cat = "General";
    if      (m.includes("jailbreak") || m.includes("ignore") || m.includes("dan") || m.includes("bypass")) cat = "Jailbreak";
    else if (m.includes("harm") || m.includes("suicide") || m.includes("hurt"))                            cat = "Self-harm";
    else if (m.includes("bully") || m.includes("threaten"))                                                cat = "Bullying";
    else if (m.includes("weapon") || m.includes("violen") || m.includes("shank") || m.includes("stab"))    cat = "Violence";
    else if (m.includes("sex") || m.includes("explicit") || m.includes("adult") || m.includes("porn") || m.includes("nude")) cat = "Inappropriate Content";
    else if (m.includes("drug") || m.includes("alcohol") || m.includes("weed") || m.includes("coke"))      cat = "Substance";
    counts[cat] = (counts[cat] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .filter(c => c.name !== "General" || Object.keys(counts).length === 1)
    .slice(0, 5);
}

export function buildWeeklySummary(opts: {
  pulses:  StudentPulseV3[];
  triage:  TriageRowLike[];
  acks:    PulseAcknowledgement[];
  events:  BeaconEvent[];
  now?:    number;
}): WeeklySummary {
  const now        = opts.now ?? Date.now();
  const weekStart  = lastMondayUtcStart(now);
  const weekEnd    = weekStart + 7 * DAY_MS - 1;
  const priorStart = weekStart - 7 * DAY_MS;

  const startDate = new Date(weekStart);
  const endDate   = new Date(weekEnd);
  const sameYear  = startDate.getUTCFullYear() === endDate.getUTCFullYear();
  const weekLabel = sameYear
    ? `${fmtDayMonth(startDate)} – ${fmtDayMonthYear(endDate)}`
    : `${fmtDayMonthYear(startDate)} – ${fmtDayMonthYear(endDate)}`;

  // ── Attention students (any triage row this week above silent_monitoring) ──
  const attentionMap = new Map<string, {
    student_id: string;
    highest_triage: TriageLevelLike;
    days: Set<string>;
    notify_count: number;
  }>();
  for (const t of opts.triage) {
    const ts = new Date(t.assessed_at).getTime();
    if (ts < weekStart || ts > weekEnd)        continue;
    if (t.triage === "silent_monitoring")      continue;
    const day = new Date(ts).toISOString().slice(0, 10);
    const cur = attentionMap.get(t.student_id);
    if (!cur) {
      attentionMap.set(t.student_id, {
        student_id:     t.student_id,
        highest_triage: t.triage,
        days:           new Set([day]),
        notify_count:   t.notify_immediately ? 1 : 0,
      });
    } else {
      if (TRIAGE_ORDER[t.triage] > TRIAGE_ORDER[cur.highest_triage]) cur.highest_triage = t.triage;
      cur.days.add(day);
      if (t.notify_immediately) cur.notify_count++;
    }
  }
  const attention_students = Array.from(attentionMap.values())
    .map(a => ({
      student_id:     a.student_id,
      highest_triage: a.highest_triage,
      days_in_queue:  a.days.size,
      notify_count:   a.notify_count,
    }))
    .sort((a, b) => {
      const tier = TRIAGE_ORDER[b.highest_triage] - TRIAGE_ORDER[a.highest_triage];
      if (tier !== 0) return tier;
      return b.days_in_queue - a.days_in_queue;
    });

  // ── Re-emergences (current live state from v3 engine) ──
  const re_emergence_students = opts.pulses.filter(p => p.re_emergence).map(p => p.student_id);

  // ── Improvements / regressions via trend slice ──
  // pulse.trend is 14 days oldest→newest. trend[0..6] = prior, [7..13] = recent.
  const improvement_students: { student_id: string; from: AlertLevel; to: AlertLevel }[] = [];
  const regression_students:  { student_id: string; from: AlertLevel; to: AlertLevel }[] = [];
  for (const p of opts.pulses) {
    if (p.trend.length < 14) continue;
    const prior = avg(p.trend.slice(0, 7));
    const recent = avg(p.trend.slice(7));
    const from = tierForScore(prior);
    const to   = tierForScore(recent);
    if (TIER_ORDER[to] < TIER_ORDER[from] && from !== "low") {
      improvement_students.push({ student_id: p.student_id, from, to });
    } else if (TIER_ORDER[to] > TIER_ORDER[from] && to !== "low") {
      regression_students.push({ student_id: p.student_id, from, to });
    }
  }
  improvement_students.sort((a, b) => (TIER_ORDER[b.from] - TIER_ORDER[b.to]) - (TIER_ORDER[a.from] - TIER_ORDER[a.to]));
  regression_students.sort((a, b)  => (TIER_ORDER[b.to]   - TIER_ORDER[b.from]) - (TIER_ORDER[a.to]   - TIER_ORDER[a.from]));

  // ── School avg trend (per-student recent-half avg vs prior-half avg) ──
  const recentPerStudent = opts.pulses.map(p => avg(p.trend.slice(7))).filter(v => v > 0);
  const priorPerStudent  = opts.pulses.map(p => avg(p.trend.slice(0, 7))).filter(v => v > 0);
  const school_avg_this_week = Math.round(avg(recentPerStudent));
  const school_avg_last_week = Math.round(avg(priorPerStudent));
  const school_avg_delta     = school_avg_this_week - school_avg_last_week;

  // ── Acknowledgements this week, broken down ──
  const ackBuckets = { total: 0, monitored: 0, referred: 0, escalated: 0, no_action: 0 };
  for (const a of opts.acks) {
    const ts = new Date(a.acknowledged_at).getTime();
    if (ts < weekStart || ts > weekEnd) continue;
    ackBuckets.total++;
    if (a.action_taken === "monitored") ackBuckets.monitored++;
    if (a.action_taken === "referred")  ackBuckets.referred++;
    if (a.action_taken === "escalated") ackBuckets.escalated++;
    if (a.action_taken === "no_action") ackBuckets.no_action++;
  }

  // ── Engagement deltas (raw event volume) ──
  const eventsThisWeek = opts.events.filter(e => {
    const ts = new Date(e.created_at).getTime();
    return ts >= weekStart && ts <= weekEnd;
  });
  const eventsLastWeek = opts.events.filter(e => {
    const ts = new Date(e.created_at).getTime();
    return ts >= priorStart && ts < weekStart;
  });
  const activeStudentsThisWeek = new Set(eventsThisWeek.map(e => e.student_id)).size;

  // ── Top categories from this week's flagged events ──
  const top_categories = clusterCategoriesFromEvents(eventsThisWeek);

  return {
    week_start: new Date(weekStart).toISOString(),
    week_end:   new Date(weekEnd).toISOString(),
    week_label: weekLabel,
    is_monday:  new Date(now).getUTCDay() === 1,

    attention_students,
    re_emergence_students,
    improvement_students,
    regression_students,

    school_avg_this_week,
    school_avg_last_week,
    school_avg_delta,

    acks_this_week: ackBuckets,
    top_categories,

    events_this_week:          eventsThisWeek.length,
    events_last_week:          eventsLastWeek.length,
    active_students_this_week: activeStudentsThisWeek,
  };
}

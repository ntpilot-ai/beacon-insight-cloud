/**
 * Beacon Pulse Engine
 * Recency-weighted multi-signal behavioural analytics.
 * Signals: Risk Escalation, Rapid Escalation, Activity Velocity,
 *          Repeat Topics, Block & Re-attempt, Session Intensity.
 */

export interface BeaconEvent {
  id:         number;
  created_at: string;
  student_id: string;
  platform:   string;
  prompt:     string;
  risk:       string;
  blocked:    boolean;
  matched:    string[];
  category?:  string;   // canonical snake_case, written by Aegis (see lib/categories.ts)
}

export interface PulseSignal {
  id:      string;
  label:   string;
  score:   number;
  weight:  number;
  detail:  string;
}

export type TrendShape =
  | "sudden_spike"
  | "gradual_climb"
  | "chronic"
  | "improving"
  | "normal";

export interface StudentPulse {
  student_id:        string;
  pulse_score:       number;
  raw_score:         number;       // unweighted for comparison
  trend:             number[];     // 14-day daily scores
  trend_direction:   "rising" | "falling" | "stable";
  trend_shape:       TrendShape;
  trend_delta:       number;
  rapid_escalation:  boolean;      // score doubled in last 3 days
  dominant_signal:   PulseSignal;
  signals:           PulseSignal[];
  categories:        { name: string; count: number }[];
  total_events:      number;
  first_seen:        string;
  last_seen:         string;
  alert_level:       "critical" | "high" | "medium" | "low";
  vs_school_avg?:    number;       // difference from school average (set by calculateAllPulses)
}

const RISK_SCORE: Record<string, number> = {
  critical: 100, high: 75, medium: 40, low: 5,
};

function dayStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ── Recency-weighted risk score for a single event ────────────────────────────
function eventWeight(event: BeaconEvent): number {
  const daysAgo = (Date.now() - new Date(event.created_at).getTime()) / (1000 * 60 * 60 * 24);
  if (daysAgo <= 7)  return 3.0;
  if (daysAgo <= 14) return 1.5;
  return 1.0;
}

function bucketByDay(events: BeaconEvent[]): Record<string, { total: number; high: number; medium: number; score: number }> {
  const buckets: Record<string, { total: number; high: number; medium: number; score: number }> = {};
  events.forEach(e => {
    const d = dayStr(new Date(e.created_at));
    if (!buckets[d]) buckets[d] = { total: 0, high: 0, medium: 0, score: 0 };
    buckets[d].total++;
    if (e.risk === "high" || e.risk === "critical") buckets[d].high++;
    if (e.risk === "medium") buckets[d].medium++;
  });
  Object.values(buckets).forEach(b => {
    const low = b.total - b.high - b.medium;
    b.score = Math.min(100, Math.round((b.high * 75 + b.medium * 40 + low * 5) / Math.max(b.total, 1)));
  });
  return buckets;
}

// ── Category clustering ───────────────────────────────────────────────────────
// Counts the structured Aegis category (canonical snake_case) written on each
// event. No longer re-derives from `matched` keywords — that coupling is what
// the signal-decoupling work removed, so the keyword matcher can be swapped for
// the LLM Aegis without touching Pulse. `general` is dropped: a general-only
// student has no meaningful dominant category and yields an empty array.
function clusterCategories(events: BeaconEvent[]): { name: string; count: number }[] {
  const counts: Record<string, number> = {};
  events
    .filter(e => e.risk !== "low" && e.category && e.category !== "general")
    .forEach(e => { counts[e.category!] = (counts[e.category!] || 0) + 1; });
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

// ── Trend shape classification ────────────────────────────────────────────────
function classifyTrendShape(trend: number[], delta: number): TrendShape {
  const recent  = trend.slice(-3);
  const earlier = trend.slice(0, -3);
  const recentAvg  = recent.reduce((s, v) => s + v, 0) / Math.max(recent.length, 1);
  const earlierAvg = earlier.filter(v => v > 0).reduce((s, v) => s + v, 0) / Math.max(earlier.filter(v => v > 0).length, 1);
  const activeDays = trend.filter(v => v > 0).length;
  const avgScore   = trend.reduce((s, v) => s + v, 0) / Math.max(trend.length, 1);

  if (recentAvg > earlierAvg * 2 && recentAvg > 30) return "sudden_spike";
  if (activeDays >= 10 && avgScore > 25)              return "chronic";
  if (delta > 10)                                      return "gradual_climb";
  if (delta < -10)                                     return "improving";
  return "normal";
}

// ── 14-day trend sparkline ────────────────────────────────────────────────────
function buildTrend(buckets: Record<string, any>): number[] {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return buckets[dayStr(d)]?.score ?? 0;
  });
}

// ── Signal calculators ────────────────────────────────────────────────────────

function signalEscalation(events: BeaconEvent[], buckets: Record<string, any>): PulseSignal {
  const days = Object.values(buckets).sort((a: any, b: any) => a.date > b.date ? 1 : -1) as any[];
  if (days.length < 3) return { id: "escalation", label: "Risk Escalation", score: 0, weight: 25, detail: "Insufficient data" };

  const half = Math.floor(days.length / 2);
  const earlyRate = days.slice(0, half).reduce((s: number, d: any) => s + d.high, 0) / Math.max(days.slice(0, half).reduce((s: number, d: any) => s + d.total, 0), 1);
  const lateRate  = days.slice(half).reduce((s: number, d: any) => s + d.high, 0)  / Math.max(days.slice(half).reduce((s: number, d: any) => s + d.total, 0), 1);
  const delta     = lateRate - earlyRate;
  const score     = Math.min(100, Math.round(Math.max(0, delta * 200)));

  return {
    id: "escalation", label: "Risk Escalation", score, weight: 25,
    detail: delta > 0.2
      ? `High-risk prompts have significantly increased (${(lateRate * 100).toFixed(0)}% recently vs ${(earlyRate * 100).toFixed(0)}% earlier)`
      : delta > 0.05 ? "Slight upward trend in risk level"
      : "Risk level is consistent over time",
  };
}

function signalRapidEscalation(events: BeaconEvent[], buckets: Record<string, any>): PulseSignal {
  const trend       = buildTrend(buckets);
  const recent3     = trend.slice(-3);
  const prior11     = trend.slice(0, -3).filter(v => v > 0);
  const recentAvg   = recent3.reduce((s, v) => s + v, 0) / 3;
  const priorAvg    = prior11.length ? prior11.reduce((s, v) => s + v, 0) / prior11.length : 0;
  const ratio       = priorAvg > 0 ? recentAvg / priorAvg : (recentAvg > 0 ? 3 : 0);
  const score       = Math.min(100, Math.round(Math.max(0, (ratio - 1) * 50)));
  const isRapid     = ratio >= 2 && recentAvg > 20;

  return {
    id: "rapid_escalation", label: "Rapid Escalation", score, weight: 20,
    detail: isRapid
      ? `⚡ Score has more than doubled in the last 3 days (${recentAvg.toFixed(0)} vs ${priorAvg.toFixed(0)} average)`
      : ratio > 1.3 ? "Noticeable increase in activity over the last 3 days"
      : "No sudden changes in recent activity",
  };
}

function signalVelocity(events: BeaconEvent[], buckets: Record<string, any>): PulseSignal {
  const days      = Object.keys(buckets).sort();
  if (days.length < 2) return { id: "velocity", label: "Activity Velocity", score: 0, weight: 15, detail: "Insufficient data" };
  const recent    = days.slice(-3).map(d => (buckets[d] as any).total);
  const earlier   = days.slice(0, -3).map(d => (buckets[d] as any).total);
  const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
  const earlierAvg = earlier.length ? earlier.reduce((s, v) => s + v, 0) / earlier.length : recentAvg;
  const ratio     = earlierAvg > 0 ? recentAvg / earlierAvg : 1;
  const score     = Math.min(100, Math.round(Math.max(0, (ratio - 1) * 60)));

  return {
    id: "velocity", label: "Activity Velocity", score, weight: 15,
    detail: ratio > 2
      ? `Activity more than doubled recently (${recentAvg.toFixed(1)} vs ${earlierAvg.toFixed(1)} prompts/day)`
      : ratio > 1.3 ? `Activity increasing (${recentAvg.toFixed(1)} vs ${earlierAvg.toFixed(1)} prompts/day)`
      : "Activity level is stable",
  };
}

function signalRepeatTopics(events: BeaconEvent[]): PulseSignal {
  // Semantic upgrade: counts repeated risk *categories* (the structured Aegis
  // signal) rather than repeated keywords. More meaningful and survives the
  // keyword -> LLM swap untouched.
  const highRisk = events.filter(e => e.risk === "high" || e.risk === "critical");
  const freq: Record<string, number> = {};
  highRisk.forEach(e => {
    if (e.category && e.category !== "general") freq[e.category] = (freq[e.category] || 0) + 1;
  });
  const repeats   = Object.values(freq).filter(v => v > 1).length;
  const top       = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  const score     = Math.min(100, repeats * 25);

  return {
    id: "repeat_topics", label: "Repeat Topic Patterns", score, weight: 15,
    detail: repeats > 2 ? `${repeats} categories recurring — "${top?.[0]}" appearing ${top?.[1]} times`
      : repeats > 0 ? "Some repeated risk categories detected"
      : "No repeated high-risk category patterns",
  };
}

function signalBlockedRate(events: BeaconEvent[]): PulseSignal {
  const blocked   = events.filter(e => e.blocked).length;
  const total     = events.length;
  const sorted    = [...events].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  let reAttempts  = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].blocked) {
      const next = sorted[i + 1];
      const gap  = new Date(next.created_at).getTime() - new Date(sorted[i].created_at).getTime();
      if (gap < 10 * 60 * 1000 && (next.risk === "high" || next.risk === "critical")) reAttempts++;
    }
  }
  const pct   = blocked / Math.max(total, 1);
  const score = Math.min(100, Math.round(pct * 120) + reAttempts * 15);

  return {
    id: "blocked_rate", label: "Block & Re-attempt Rate", score, weight: 15,
    detail: reAttempts > 2
      ? `${blocked} prompts blocked — re-attempted ${reAttempts} times after blocks`
      : blocked > 3 ? `${blocked} prompts blocked (${Math.round(pct * 100)}% of all activity)`
      : blocked > 0 ? `${blocked} prompt${blocked > 1 ? "s" : ""} blocked`
      : "No prompts blocked",
  };
}

function signalSessionIntensity(events: BeaconEvent[]): PulseSignal {
  // School day window: 5+ flagged prompts in one school day
  const byDay: Record<string, number> = {};
  events.filter(e => e.risk !== "low").forEach(e => {
    const d = dayStr(new Date(e.created_at));
    byDay[d] = (byDay[d] || 0) + 1;
  });
  const maxDay  = Math.max(0, ...Object.values(byDay));
  const score   = Math.min(100, maxDay * 15);
  const topDay  = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];

  return {
    id: "intensity", label: "Session Intensity", score, weight: 10,
    detail: maxDay >= 5
      ? `${maxDay} flagged prompts in a single day${topDay ? ` (${new Date(topDay[0]).toLocaleDateString("en-GB", { day: "numeric", month: "short" })})` : ""}`
      : maxDay >= 3 ? `${maxDay} flagged prompts in one day detected`
      : "No concentrated high-risk sessions",
  };
}

// ── Main calculators ──────────────────────────────────────────────────────────

export function calculatePulse(studentId: string, events: BeaconEvent[]): StudentPulse {
  const buckets       = bucketByDay(events);
  const trend         = buildTrend(buckets);
  const categories    = clusterCategories(events);

  const signals: PulseSignal[] = [
    signalEscalation(events, buckets),
    signalRapidEscalation(events, buckets),
    signalVelocity(events, buckets),
    signalRepeatTopics(events),
    signalBlockedRate(events),
    signalSessionIntensity(events),
  ];

  // Weighted composite score
  const totalWeight = signals.reduce((s, sig) => s + sig.weight, 0);
  const rawScore    = Math.round(signals.reduce((s, sig) => s + sig.score * sig.weight, 0) / totalWeight);

  // Apply overall recency multiplier — recent activity weighs more
  const recentEvents  = events.filter(e => {
    const daysAgo = (Date.now() - new Date(e.created_at).getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo <= 7;
  });
  const recentRiskRate = recentEvents.filter(e => e.risk !== "low").length / Math.max(recentEvents.length, 1);
  const recencyBoost  = Math.min(20, Math.round(recentRiskRate * 30));
  const pulseScore    = Math.min(100, rawScore + recencyBoost);

  // Trend
  const recentHalf    = trend.slice(7);
  const earlierHalf   = trend.slice(0, 7);
  const recentAvg     = recentHalf.reduce((s, v) => s + v, 0) / 7;
  const earlierAvg    = earlierHalf.reduce((s, v) => s + v, 0) / 7;
  const trendDelta    = Math.round(recentAvg - earlierAvg);
  const trendDir      = trendDelta > 5 ? "rising" : trendDelta < -5 ? "falling" : "stable";
  const trendShape    = classifyTrendShape(trend, trendDelta);

  // Rapid escalation flag
  const recentTrend3  = trend.slice(-3);
  const priorTrend    = trend.slice(0, -3).filter(v => v > 0);
  const recentAvg3    = recentTrend3.reduce((s, v) => s + v, 0) / 3;
  const priorAvgAll   = priorTrend.length ? priorTrend.reduce((s, v) => s + v, 0) / priorTrend.length : 0;
  const rapidEscalation = recentAvg3 >= priorAvgAll * 2 && recentAvg3 > 20;

  const dominant      = [...signals].sort((a, b) => (b.score * b.weight) - (a.score * a.weight))[0];
  const sorted        = events.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const alertLevel    =
    pulseScore >= 70 ? "critical" :
    pulseScore >= 50 ? "high" :
    pulseScore >= 25 ? "medium" : "low";

  return {
    student_id:       studentId,
    pulse_score:      pulseScore,
    raw_score:        rawScore,
    trend,
    trend_direction:  trendDir,
    trend_shape:      trendShape,
    trend_delta:      trendDelta,
    rapid_escalation: rapidEscalation,
    dominant_signal:  dominant,
    signals,
    categories,
    total_events:     events.length,
    first_seen:       sorted[0]?.created_at ?? "",
    last_seen:        sorted[sorted.length - 1]?.created_at ?? "",
    alert_level:      alertLevel,
  };
}

export function calculateAllPulses(events: BeaconEvent[]): StudentPulse[] {
  const byStudent: Record<string, BeaconEvent[]> = {};
  events.forEach(e => {
    if (!byStudent[e.student_id]) byStudent[e.student_id] = [];
    byStudent[e.student_id].push(e);
  });

  const pulses = Object.entries(byStudent)
    .map(([id, evts]) => calculatePulse(id, evts))
    .sort((a, b) => b.pulse_score - a.pulse_score);

  // Calculate school average and set vs_school_avg
  const avg = pulses.reduce((s, p) => s + p.pulse_score, 0) / Math.max(pulses.length, 1);
  pulses.forEach(p => { p.vs_school_avg = Math.round(p.pulse_score - avg); });

  return pulses;
}

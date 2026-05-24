/**
 * Beacon Pulse Engine v3
 * Stateful, acknowledgement-aware behavioural analytics.
 *
 * Three-layer scoring:
 *   Layer 1 — Historical fingerprint (events older than 7d OR pre-last-ack)
 *             Frozen baseline_score, dominant categories, chronic/improving/normal pattern.
 *   Layer 2 — Near-term (events after the fingerprint window)
 *             v2-style signal scoring with 3x recency weighting + drift detection.
 *             Fires re_emergence when an acknowledged category resurfaces.
 *             Also includes conversational_context: behavioural-arc reading of
 *             sessions where Aegis triggered, so follow-up messages that don't
 *             themselves match keywords still contribute to the score.
 *   Layer 3 — Real-time (last 24h)
 *             Session intensity + rapid escalation override the acknowledgement
 *             dampening — staff are kept informed of new spikes regardless.
 */

import { groupSessions, mergeAnalyses, ConversationSession, SessionAnalysis } from "./sessions";

export type { SessionAnalysis } from "./sessions";

export interface BeaconEvent {
  id:         number;
  created_at: string;
  student_id: string;
  platform:   string;
  prompt:     string;
  risk:       string;
  blocked:    boolean;
  matched:    string[];
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

export type AcknowledgeAction = "monitored" | "referred" | "escalated" | "no_action";

export interface PulseAcknowledgement {
  id:                string;
  school_id:         string;
  student_id:        string;
  acknowledged_by:   string;
  acknowledged_at:   string;
  alert_level:       string;
  dominant_category: string | null;
  action_taken:      AcknowledgeAction;
  notes?:            string | null;
  expires_at?:       string | null;
}

export interface BehaviouralFingerprint {
  baseline_score:      number;
  dominant_categories: string[];
  pattern:             "chronic" | "improving" | "normal";
  event_count:         number;
  window_start:        string;
  window_end:          string;
}

export interface StudentPulseV3 {
  student_id:        string;
  pulse_score:       number;
  raw_score:         number;
  trend:             number[];
  trend_direction:   "rising" | "falling" | "stable";
  trend_shape:       TrendShape;
  trend_delta:       number;
  rapid_escalation:  boolean;
  dominant_signal:   PulseSignal;
  signals:           PulseSignal[];
  categories:        { name: string; count: number }[];
  total_events:      number;
  first_seen:        string;
  last_seen:         string;
  alert_level:       "critical" | "high" | "medium" | "low";
  vs_school_avg?:    number;

  // v3 additions
  fingerprint:       BehaviouralFingerprint;
  re_emergence:      boolean;
  last_acknowledged?: PulseAcknowledgement;
  context_boost:     number;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

const DAY_MS  = 86400000;
const SEVEN_D = 7 * DAY_MS;
const ONE_D   = DAY_MS;

function dayStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function ts(s: string): number {
  return new Date(s).getTime();
}

type DayBucket = { total: number; high: number; medium: number; score: number };

function bucketByDay(events: BeaconEvent[]): Record<string, DayBucket> {
  const buckets: Record<string, DayBucket> = {};
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

function clusterCategories(events: BeaconEvent[]): { name: string; count: number }[] {
  const counts: Record<string, number> = {};
  events.filter(e => e.risk !== "low").forEach(e => {
    const m = (e.matched || []).join(" ").toLowerCase();
    let cat = "General";
    if (m.includes("jailbreak") || m.includes("ignore") || m.includes("dan") || m.includes("bypass")) cat = "Jailbreak";
    else if (m.includes("harm") || m.includes("suicide") || m.includes("hurt")) cat = "Self-harm";
    else if (m.includes("bully") || m.includes("threaten")) cat = "Bullying";
    else if (m.includes("weapon") || m.includes("violen") || m.includes("shank") || m.includes("stab")) cat = "Violence";
    else if (m.includes("sex") || m.includes("explicit") || m.includes("adult") || m.includes("porn") || m.includes("nude")) cat = "Inappropriate Content";
    else if (m.includes("drug") || m.includes("alcohol") || m.includes("weed") || m.includes("coke")) cat = "Substance";
    counts[cat] = (counts[cat] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .filter(c => c.name !== "General" || Object.keys(counts).length === 1);
}

function buildTrend(buckets: Record<string, DayBucket>): number[] {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return buckets[dayStr(d)]?.score ?? 0;
  });
}

function classifyTrendShape(trend: number[], delta: number): TrendShape {
  const recent     = trend.slice(-3);
  const earlier    = trend.slice(0, -3);
  const recentAvg  = recent.reduce((s, v) => s + v, 0) / Math.max(recent.length, 1);
  const nonzero    = earlier.filter(v => v > 0);
  const earlierAvg = nonzero.length ? nonzero.reduce((s, v) => s + v, 0) / nonzero.length : 0;
  const activeDays = trend.filter(v => v > 0).length;
  const avgScore   = trend.reduce((s, v) => s + v, 0) / Math.max(trend.length, 1);

  if (recentAvg > earlierAvg * 2 && recentAvg > 30) return "sudden_spike";
  if (activeDays >= 10 && avgScore > 25)             return "chronic";
  if (delta > 10)                                     return "gradual_climb";
  if (delta < -10)                                    return "improving";
  return "normal";
}

// ── Signal calculators (same shape as engine v2 but operate on a given event subset) ──

function signalEscalation(buckets: Record<string, DayBucket>): PulseSignal {
  const days = Object.values(buckets);
  if (days.length < 3) return { id: "escalation", label: "Risk Escalation", score: 0, weight: 25, detail: "Insufficient data" };

  const half = Math.floor(days.length / 2);
  const earlyHigh  = days.slice(0, half).reduce((s, d) => s + d.high, 0);
  const earlyTotal = days.slice(0, half).reduce((s, d) => s + d.total, 0);
  const lateHigh   = days.slice(half).reduce((s, d) => s + d.high, 0);
  const lateTotal  = days.slice(half).reduce((s, d) => s + d.total, 0);
  const earlyRate  = earlyHigh / Math.max(earlyTotal, 1);
  const lateRate   = lateHigh  / Math.max(lateTotal, 1);
  const delta      = lateRate - earlyRate;
  const score      = Math.min(100, Math.round(Math.max(0, delta * 200)));

  return {
    id: "escalation", label: "Risk Escalation", score, weight: 25,
    detail: delta > 0.2
      ? `High-risk prompts up sharply (${(lateRate * 100).toFixed(0)}% vs ${(earlyRate * 100).toFixed(0)}% earlier)`
      : delta > 0.05 ? "Slight upward trend in risk level"
      : "Risk level consistent over the live window",
  };
}

function signalRapidEscalation(buckets: Record<string, DayBucket>): PulseSignal {
  const trend     = buildTrend(buckets);
  const recent3   = trend.slice(-3);
  const prior     = trend.slice(0, -3).filter(v => v > 0);
  const recentAvg = recent3.reduce((s, v) => s + v, 0) / 3;
  const priorAvg  = prior.length ? prior.reduce((s, v) => s + v, 0) / prior.length : 0;
  const ratio     = priorAvg > 0 ? recentAvg / priorAvg : (recentAvg > 0 ? 3 : 0);
  const score     = Math.min(100, Math.round(Math.max(0, (ratio - 1) * 50)));
  const isRapid   = ratio >= 2 && recentAvg > 20;

  return {
    id: "rapid_escalation", label: "Rapid Escalation", score, weight: 20,
    detail: isRapid
      ? `⚡ Score more than doubled in last 3 days (${recentAvg.toFixed(0)} vs ${priorAvg.toFixed(0)})`
      : ratio > 1.3 ? "Noticeable increase in recent activity"
      : "No sudden recent changes",
  };
}

function signalVelocity(buckets: Record<string, DayBucket>): PulseSignal {
  const days = Object.keys(buckets).sort();
  if (days.length < 2) return { id: "velocity", label: "Activity Velocity", score: 0, weight: 15, detail: "Insufficient data" };
  const recent     = days.slice(-3).map(d => buckets[d].total);
  const earlier    = days.slice(0, -3).map(d => buckets[d].total);
  const recentAvg  = recent.reduce((s, v) => s + v, 0) / recent.length;
  const earlierAvg = earlier.length ? earlier.reduce((s, v) => s + v, 0) / earlier.length : recentAvg;
  const ratio      = earlierAvg > 0 ? recentAvg / earlierAvg : 1;
  const score      = Math.min(100, Math.round(Math.max(0, (ratio - 1) * 60)));

  return {
    id: "velocity", label: "Activity Velocity", score, weight: 15,
    detail: ratio > 2
      ? `Activity more than doubled (${recentAvg.toFixed(1)} vs ${earlierAvg.toFixed(1)} prompts/day)`
      : ratio > 1.3 ? `Activity increasing (${recentAvg.toFixed(1)} vs ${earlierAvg.toFixed(1)})`
      : "Activity level is stable",
  };
}

function signalRepeatTopics(events: BeaconEvent[]): PulseSignal {
  const highRisk = events.filter(e => e.risk === "high" || e.risk === "critical");
  const matched  = highRisk.flatMap(e => e.matched || []);
  const freq: Record<string, number> = {};
  matched.forEach(m => { freq[m] = (freq[m] || 0) + 1; });
  const repeats  = Object.values(freq).filter(v => v > 1).length;
  const top      = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  const score    = Math.min(100, repeats * 25);

  return {
    id: "repeat_topics", label: "Repeat Topic Patterns", score, weight: 15,
    detail: repeats > 2 ? `${repeats} keywords repeatedly matched — "${top?.[0]}" appearing ${top?.[1]} times`
      : repeats > 0 ? "Some repeated keyword matches detected"
      : "No repeated high-risk keyword patterns",
  };
}

function signalBlockedRate(events: BeaconEvent[]): PulseSignal {
  const blocked = events.filter(e => e.blocked).length;
  const total   = events.length;
  const sorted  = [...events].sort((a, b) => ts(a.created_at) - ts(b.created_at));
  let reAttempts = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].blocked) {
      const gap = ts(sorted[i + 1].created_at) - ts(sorted[i].created_at);
      if (gap < 10 * 60 * 1000 && (sorted[i + 1].risk === "high" || sorted[i + 1].risk === "critical")) reAttempts++;
    }
  }
  const pct   = blocked / Math.max(total, 1);
  const score = Math.min(100, Math.round(pct * 120) + reAttempts * 15);

  return {
    id: "blocked_rate", label: "Block & Re-attempt Rate", score, weight: 15,
    detail: reAttempts > 2
      ? `${blocked} prompts blocked — re-attempted ${reAttempts}× after blocks`
      : blocked > 3 ? `${blocked} prompts blocked (${Math.round(pct * 100)}% of activity)`
      : blocked > 0 ? `${blocked} prompt${blocked > 1 ? "s" : ""} blocked`
      : "No prompts blocked",
  };
}

function signalSessionIntensity(events: BeaconEvent[]): PulseSignal {
  const byDay: Record<string, number> = {};
  events.filter(e => e.risk !== "low").forEach(e => {
    const d = dayStr(new Date(e.created_at));
    byDay[d] = (byDay[d] || 0) + 1;
  });
  const maxDay = Math.max(0, ...Object.values(byDay));
  const score  = Math.min(100, maxDay * 15);
  const topDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];

  return {
    id: "intensity", label: "Session Intensity", score, weight: 10,
    detail: maxDay >= 5
      ? `${maxDay} flagged prompts in one day${topDay ? ` (${new Date(topDay[0]).toLocaleDateString("en-GB", { day: "numeric", month: "short" })})` : ""}`
      : maxDay >= 3 ? `${maxDay} flagged prompts in one day detected`
      : "No concentrated high-risk sessions",
  };
}

// Reads the behavioural arc of triggered sessions. Until the LLM analysis
// pass (step 4) lands, sentiment_arc / context_risk / requires_review default
// on every session, so this signal scores purely off structural facts:
// how many sessions Aegis triggered, and how much conversation followed each
// trigger. Once analysis populates those fields, the same signal will pick
// up "escalating" / "unresolved" / "requires_review" weight automatically.
function signalConversationalContext(sessions: ConversationSession<BeaconEvent>[]): PulseSignal {
  const triggered = sessions.filter(s => s.has_trigger);

  if (!triggered.length) {
    return {
      id: "conversational_context", label: "Conversational Context",
      score: 0, weight: 15, detail: "No triggered conversations in window",
    };
  }

  const totalFollowups   = triggered.reduce((s, ses) => s + ses.context_window_events.length, 0);
  const longTail         = triggered.filter(s => s.context_window_events.length >= 5).length;
  const requiringReview  = triggered.filter(s => s.requires_review).length;
  const escalatingArc    = triggered.filter(s => s.sentiment_arc === "escalating" || s.sentiment_arc === "unresolved").length;
  const highContextRisk  = triggered.filter(s => s.context_risk === "high").length;

  // Sentiment-only contributions — softer than LLM verdicts but visible. These
  // fire for sessions whose pre-filter score didn't escalate to a full LLM
  // pass but whose trajectory was still noteworthy.
  const deteriorating    = triggered.filter(s => s.sentiment?.trend === "deteriorating").length;
  const volatileCount    = triggered.filter(s => s.sentiment?.trend === "volatile").length;

  // Structural floor + LLM verdict heft + sentiment-only softer signal.
  const score = Math.min(
    100,
    triggered.length * 15
    + longTail * 5
    + escalatingArc * 25
    + highContextRisk * 20
    + requiringReview * 30
    + deteriorating * 12
    + volatileCount * 8,
  );

  let detail: string;
  if (requiringReview > 0) {
    detail = `${requiringReview} session${requiringReview !== 1 ? "s" : ""} flagged for staff review by context analysis`;
  } else if (escalatingArc > 0 || highContextRisk > 0) {
    detail = `${triggered.length} triggered session${triggered.length !== 1 ? "s" : ""} — ${escalatingArc + highContextRisk} showing concerning behavioural arc`;
  } else if (deteriorating > 0 || volatileCount > 0) {
    detail = `${triggered.length} triggered session${triggered.length !== 1 ? "s" : ""} — ${deteriorating + volatileCount} with unstable sentiment trajectory`;
  } else if (longTail > 0) {
    detail = `${triggered.length} triggered session${triggered.length !== 1 ? "s" : ""} with ${totalFollowups} follow-up message${totalFollowups !== 1 ? "s" : ""} (${longTail} sustained)`;
  } else {
    detail = `${triggered.length} triggered session${triggered.length !== 1 ? "s" : ""} with brief follow-up`;
  }

  return {
    id: "conversational_context", label: "Conversational Context",
    score, weight: 15, detail,
  };
}

function runSignals(events: BeaconEvent[], buckets: Record<string, DayBucket>): PulseSignal[] {
  return [
    signalEscalation(buckets),
    signalRapidEscalation(buckets),
    signalVelocity(buckets),
    signalRepeatTopics(events),
    signalBlockedRate(events),
    signalSessionIntensity(events),
  ];
}

// ── Layer 1: behavioural fingerprint ──────────────────────────────────────────

function buildFingerprint(historicalEvents: BeaconEvent[], windowEnd: number): BehaviouralFingerprint {
  const buckets    = bucketByDay(historicalEvents);
  const days       = Object.values(buckets);
  const total      = days.reduce((s, d) => s + d.total, 0);
  const high       = days.reduce((s, d) => s + d.high, 0);
  const medium     = days.reduce((s, d) => s + d.medium, 0);
  const low        = total - high - medium;
  const activeDays = days.filter(d => d.score > 0).length;
  const avgScore   = days.length ? days.reduce((s, d) => s + d.score, 0) / days.length : 0;

  // Baseline score: weighted average of risk in this window
  const baseline = total > 0
    ? Math.min(100, Math.round((high * 75 + medium * 40 + low * 5) / total))
    : 0;

  // Pattern: chronic if sustained activity & elevated, improving if scores trending down, else normal
  const sorted = Object.keys(buckets).sort();
  const firstHalf  = sorted.slice(0, Math.floor(sorted.length / 2)).map(k => buckets[k].score);
  const secondHalf = sorted.slice(Math.floor(sorted.length / 2)).map(k => buckets[k].score);
  const firstAvg   = firstHalf.length  ? firstHalf.reduce((s, v) => s + v, 0)  / firstHalf.length  : 0;
  const secondAvg  = secondHalf.length ? secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length : 0;

  let pattern: "chronic" | "improving" | "normal" = "normal";
  if (activeDays >= 10 && avgScore > 25)     pattern = "chronic";
  else if (firstAvg > 25 && secondAvg < firstAvg * 0.6) pattern = "improving";

  const cats = clusterCategories(historicalEvents).slice(0, 3).map(c => c.name);

  const sortedByTime = [...historicalEvents].sort((a, b) => ts(a.created_at) - ts(b.created_at));

  return {
    baseline_score:      baseline,
    dominant_categories: cats,
    pattern,
    event_count:         historicalEvents.length,
    window_start:        sortedByTime[0]?.created_at ?? "",
    window_end:          new Date(windowEnd).toISOString(),
  };
}

// ── Main per-student calculator ───────────────────────────────────────────────

function calculatePulseV3(
  studentId: string,
  events:    BeaconEvent[],
  acks:      PulseAcknowledgement[],
  analyses:  SessionAnalysis[],
): StudentPulseV3 {
  const now      = Date.now();

  // Active (non-expired) acknowledgements for this student, newest first
  const studentAcks = acks
    .filter(a => a.student_id === studentId)
    .filter(a => !a.expires_at || ts(a.expires_at) > now)
    .sort((a, b) => ts(b.acknowledged_at) - ts(a.acknowledged_at));
  const lastAck = studentAcks[0];

  // Fingerprint window ends at max(7 days ago, last_ack timestamp).
  // The ack effectively extends the "known baseline" up to its moment.
  const ackTime = lastAck ? ts(lastAck.acknowledged_at) : 0;
  const fpEnd   = Math.max(now - SEVEN_D, ackTime);

  const historical = events.filter(e => ts(e.created_at) <= fpEnd);
  const nearTerm   = events.filter(e => ts(e.created_at) >  fpEnd);
  const realTime   = events.filter(e => now - ts(e.created_at) <= ONE_D);

  // ── Layer 1: fingerprint ──
  const fingerprint = buildFingerprint(historical, fpEnd);

  // ── Layer 2: near-term signals (this is the live alert) ──
  const ntBuckets = bucketByDay(nearTerm);
  const ntSignals = runSignals(nearTerm, ntBuckets);

  // Step 2/3: conversational context. Sessions are derived once across all of
  // this student's events (so a session that started before the fingerprint
  // window but extended into near-term is still recognised by its tail),
  // overlaid with any cached LLM analysis verdicts (step 4), then filtered to
  // those that touched the near-term layer.
  const allSessions = mergeAnalyses(groupSessions(events), analyses);
  const ntSessions  = allSessions.filter(s => ts(s.ended_at) > fpEnd);
  ntSignals.push(signalConversationalContext(ntSessions));

  const totalW = ntSignals.reduce((s, sig) => s + sig.weight, 0);
  const rawScore  = totalW > 0
    ? Math.round(ntSignals.reduce((s, sig) => s + sig.score * sig.weight, 0) / totalW)
    : 0;

  // Recency boost on near-term (same shape as v2 — recent risk rate pushes the score up)
  const sevenAgo       = now - SEVEN_D;
  const recentEvents   = nearTerm.filter(e => ts(e.created_at) >= sevenAgo);
  const recentRiskRate = recentEvents.length
    ? recentEvents.filter(e => e.risk !== "low").length / recentEvents.length
    : 0;
  const recencyBoost   = Math.min(20, Math.round(recentRiskRate * 30));

  // Re-emergence: an acknowledged category resurfaces in near-term
  const ntCategories = clusterCategories(nearTerm);
  const re_emergence = !!(
    lastAck &&
    lastAck.dominant_category &&
    ntCategories.some(c => c.name === lastAck.dominant_category && c.count >= 2)
  );

  // ── Layer 3: real-time override ──
  // If the last 24h shows immediate concern, the ack dampening is suppressed —
  // staff get the live signal regardless of prior sign-off.
  const rtFlagged   = realTime.filter(e => e.risk !== "low").length;
  const rtHighOrCrit = realTime.some(e => e.risk === "critical" || e.risk === "high");
  const layer3Override = rtFlagged >= 3 || (rtHighOrCrit && rtFlagged >= 2);

  // ── Context boost ──
  let context_boost = 0;
  if (lastAck && lastAck.action_taken !== "no_action") {
    const daysSinceAck = (now - ackTime) / DAY_MS;
    if (daysSinceAck < 14) context_boost -= 10;
  }
  if (re_emergence)     context_boost += 25;
  if (layer3Override)   context_boost = Math.max(context_boost, 0);

  // Final pulse score
  const pulseScore = Math.max(0, Math.min(100, rawScore + recencyBoost + context_boost));

  // Trend visualisation uses the full event set (last 14 days regardless of layer)
  const fullBuckets  = bucketByDay(events);
  const trend        = buildTrend(fullBuckets);
  const recentHalf   = trend.slice(7);
  const earlierHalf  = trend.slice(0, 7);
  const recentAvg    = recentHalf.reduce((s, v) => s + v, 0) / 7;
  const earlierAvg   = earlierHalf.reduce((s, v) => s + v, 0) / 7;
  const trendDelta   = Math.round(recentAvg - earlierAvg);
  const trendDir     = trendDelta > 5 ? "rising" : trendDelta < -5 ? "falling" : "stable";
  const trendShape   = classifyTrendShape(trend, trendDelta);

  // rapid_escalation flag (same v2 logic but on full set so the UI badge is consistent)
  const recent3     = trend.slice(-3);
  const priorTrend  = trend.slice(0, -3).filter(v => v > 0);
  const recentAvg3  = recent3.reduce((s, v) => s + v, 0) / 3;
  const priorAvgAll = priorTrend.length ? priorTrend.reduce((s, v) => s + v, 0) / priorTrend.length : 0;
  const rapid_escalation = recentAvg3 >= priorAvgAll * 2 && recentAvg3 > 20;

  const dominant_signal = [...ntSignals].sort((a, b) => (b.score * b.weight) - (a.score * a.weight))[0]
                       ?? ntSignals[0];
  const categories = clusterCategories(events);

  const sorted = [...events].sort((a, b) => ts(a.created_at) - ts(b.created_at));

  const alert_level: StudentPulseV3["alert_level"] =
    pulseScore >= 70 ? "critical" :
    pulseScore >= 50 ? "high" :
    pulseScore >= 25 ? "medium" : "low";

  return {
    student_id:        studentId,
    pulse_score:       pulseScore,
    raw_score:         rawScore,
    trend,
    trend_direction:   trendDir,
    trend_shape:       trendShape,
    trend_delta:       trendDelta,
    rapid_escalation,
    dominant_signal,
    signals:           ntSignals,
    categories,
    total_events:      events.length,
    first_seen:        sorted[0]?.created_at ?? "",
    last_seen:         sorted[sorted.length - 1]?.created_at ?? "",
    alert_level,

    fingerprint,
    re_emergence,
    last_acknowledged: lastAck,
    context_boost,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function calculateAllPulsesV3(
  events: BeaconEvent[],
  acknowledgements: PulseAcknowledgement[] = [],
  sessionAnalyses:  SessionAnalysis[] = [],
): StudentPulseV3[] {
  const byStudent: Record<string, BeaconEvent[]> = {};
  events.forEach(e => {
    if (!byStudent[e.student_id]) byStudent[e.student_id] = [];
    byStudent[e.student_id].push(e);
  });

  // Pre-bucket analyses by student so each per-student calc only sees its own.
  const analysesByStudent: Record<string, SessionAnalysis[]> = {};
  sessionAnalyses.forEach(a => {
    const sid = a.session_id.split("|")[0];
    if (!analysesByStudent[sid]) analysesByStudent[sid] = [];
    analysesByStudent[sid].push(a);
  });

  const pulses = Object.entries(byStudent)
    .map(([id, evts]) => calculatePulseV3(id, evts, acknowledgements, analysesByStudent[id] || []))
    .sort((a, b) => b.pulse_score - a.pulse_score);

  const avg = pulses.length
    ? pulses.reduce((s, p) => s + p.pulse_score, 0) / pulses.length
    : 0;
  pulses.forEach(p => { p.vs_school_avg = Math.round(p.pulse_score - avg); });

  return pulses;
}

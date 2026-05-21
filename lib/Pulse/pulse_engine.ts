/**
 * Beacon Pulse Engine
 * Analyses student behaviour over time across 6 signals.
 * Returns a 0-100 Pulse score + dominant signal + 7-day trend.
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
}

export interface DayBucket {
  date:   string; // ISO date YYYY-MM-DD
  total:  number;
  high:   number;
  medium: number;
  score:  number; // pulse score for that day
}

export interface PulseSignal {
  id:       string;
  label:    string;
  score:    number; // 0-100
  weight:   number; // contribution weight
  detail:   string; // human readable explanation
}

export interface StudentPulse {
  student_id:      string;
  pulse_score:     number;       // 0-100 weighted composite
  trend:           number[];     // last 14 days of daily scores
  trend_direction: "rising" | "falling" | "stable";
  trend_delta:     number;       // change over last 7 days
  dominant_signal: PulseSignal;
  signals:         PulseSignal[];
  total_events:    number;
  first_seen:      string;
  last_seen:       string;
  alert_level:     "critical" | "high" | "medium" | "low";
}

const RISK_SCORE: Record<string, number> = {
  critical: 100,
  high:     75,
  medium:   40,
  low:      5,
};

function dayStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function bucketByDay(events: BeaconEvent[]): Record<string, DayBucket> {
  const buckets: Record<string, DayBucket> = {};
  events.forEach(e => {
    const d = dayStr(new Date(e.created_at));
    if (!buckets[d]) buckets[d] = { date: d, total: 0, high: 0, medium: 0, score: 0 };
    buckets[d].total++;
    if (e.risk === "high" || e.risk === "critical") buckets[d].high++;
    if (e.risk === "medium") buckets[d].medium++;
  });
  // Daily score = weighted average of risk scores
  Object.values(buckets).forEach(b => {
    const low = b.total - b.high - b.medium;
    b.score = Math.min(100, Math.round(
      (b.high * 75 + b.medium * 40 + low * 5) / Math.max(b.total, 1)
    ));
  });
  return buckets;
}

// ── Signal calculators ──────────────────────────────────────────────────────

function signalVelocity(events: BeaconEvent[], buckets: Record<string, DayBucket>): PulseSignal {
  const days = Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < 2) return { id: "velocity", label: "Activity Velocity", score: 0, weight: 20, detail: "Insufficient data" };

  const recentDays  = days.slice(-3);
  const earlierDays = days.slice(0, -3);
  const recentAvg   = recentDays.reduce((s, d) => s + d.total, 0) / recentDays.length;
  const earlierAvg  = earlierDays.length
    ? earlierDays.reduce((s, d) => s + d.total, 0) / earlierDays.length
    : recentAvg;

  const ratio  = earlierAvg > 0 ? recentAvg / earlierAvg : 1;
  const score  = Math.min(100, Math.round(Math.max(0, (ratio - 1) * 60)));
  const detail = ratio > 2
    ? `Activity has more than doubled recently (${recentAvg.toFixed(1)} vs ${earlierAvg.toFixed(1)} prompts/day)`
    : ratio > 1.3
    ? `Activity is increasing (${recentAvg.toFixed(1)} vs ${earlierAvg.toFixed(1)} prompts/day)`
    : `Activity level is stable`;

  return { id: "velocity", label: "Activity Velocity", score, weight: 20, detail };
}

function signalEscalation(events: BeaconEvent[], buckets: Record<string, DayBucket>): PulseSignal {
  const days = Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < 3) return { id: "escalation", label: "Risk Escalation", score: 0, weight: 30, detail: "Insufficient data" };

  // Compare risk rate in first half vs second half of history
  const half       = Math.floor(days.length / 2);
  const earlyDays  = days.slice(0, half);
  const lateDays   = days.slice(half);

  const earlyHighRate = earlyDays.reduce((s, d) => s + d.high, 0) / Math.max(earlyDays.reduce((s, d) => s + d.total, 0), 1);
  const lateHighRate  = lateDays.reduce((s, d)  => s + d.high, 0) / Math.max(lateDays.reduce((s, d)  => s + d.total, 0), 1);

  const delta = lateHighRate - earlyHighRate;
  const score = Math.min(100, Math.round(Math.max(0, delta * 200)));

  const detail = delta > 0.2
    ? `High-risk prompts have significantly increased (${(lateHighRate * 100).toFixed(0)}% recently vs ${(earlyHighRate * 100).toFixed(0)}% earlier)`
    : delta > 0.05
    ? `Slight upward trend in risk level`
    : `Risk level is consistent over time`;

  return { id: "escalation", label: "Risk Escalation", score, weight: 30, detail };
}

function signalTimeShift(events: BeaconEvent[]): PulseSignal {
  const outOfHours = events.filter(e => {
    const h = new Date(e.created_at).getHours();
    return h < 7 || h > 21;
  });

  const pct   = outOfHours.length / Math.max(events.length, 1);
  const score = Math.min(100, Math.round(pct * 150));

  const detail = pct > 0.5
    ? `${Math.round(pct * 100)}% of activity is outside school hours — majority late night or early morning`
    : pct > 0.2
    ? `${Math.round(pct * 100)}% of activity outside normal hours`
    : `Activity mostly within normal school hours`;

  return { id: "time_shift", label: "Out-of-Hours Activity", score, weight: 15, detail };
}

function signalPlatformHopping(events: BeaconEvent[]): PulseSignal {
  const platforms = new Set(events.map(e => e.platform));
  const count  = platforms.size;
  const score  = Math.min(100, Math.round((count - 1) * 25));
  const detail = count > 3
    ? `Using ${count} different AI platforms — may be seeking one with weaker filters`
    : count > 1
    ? `Active on ${count} platforms: ${[...platforms].join(", ")}`
    : `Using single platform consistently`;

  return { id: "platform", label: "Platform Switching", score, weight: 10, detail };
}

function signalRepeatTopics(events: BeaconEvent[]): PulseSignal {
  const highRisk = events.filter(e => e.risk === "high" || e.risk === "critical");
  const matched  = highRisk.flatMap(e => e.matched || []);
  const freq: Record<string, number> = {};
  matched.forEach(m => { freq[m] = (freq[m] || 0) + 1; });
  const repeats = Object.values(freq).filter(v => v > 1).length;
  const score   = Math.min(100, repeats * 25);

  const topKeyword = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  const detail = repeats > 2
    ? `${repeats} keywords repeatedly matched — "${topKeyword?.[0]}" appearing ${topKeyword?.[1]} times`
    : repeats > 0
    ? `Some repeated keyword matches detected`
    : `No repeated high-risk keyword patterns`;

  return { id: "repeat_topics", label: "Repeat Topic Patterns", score, weight: 15, detail };
}

function signalSessionIntensity(events: BeaconEvent[]): PulseSignal {
  // Find any 30-minute window with 3+ medium/high risk events
  const flagged = events
    .filter(e => e.risk !== "low")
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  let maxWindow = 0;
  for (let i = 0; i < flagged.length; i++) {
    const windowStart = new Date(flagged[i].created_at).getTime();
    let count = 1;
    for (let j = i + 1; j < flagged.length; j++) {
      if (new Date(flagged[j].created_at).getTime() - windowStart <= 30 * 60 * 1000) count++;
      else break;
    }
    maxWindow = Math.max(maxWindow, count);
  }

  const score  = Math.min(100, maxWindow * 20);
  const detail = maxWindow >= 5
    ? `${maxWindow} flagged prompts in a single 30-minute session — high intensity incident`
    : maxWindow >= 3
    ? `${maxWindow} flagged prompts in a 30-minute window detected`
    : `No concentrated high-risk sessions detected`;

  return { id: "intensity", label: "Session Intensity", score, weight: 10, detail };
}

// ── 14-day trend sparkline ──────────────────────────────────────────────────

function buildTrend(buckets: Record<string, DayBucket>): number[] {
  const trend: number[] = [];
  for (let i = 13; i >= 0; i--) {
    const d   = new Date();
    d.setDate(d.getDate() - i);
    const key = dayStr(d);
    trend.push(buckets[key]?.score ?? 0);
  }
  return trend;
}

// ── Main export ─────────────────────────────────────────────────────────────

export function calculatePulse(studentId: string, events: BeaconEvent[]): StudentPulse {
  const buckets = bucketByDay(events);

  const signals: PulseSignal[] = [
    signalEscalation(events, buckets),
    signalVelocity(events, buckets),
    signalTimeShift(events),
    signalRepeatTopics(events),
    signalPlatformHopping(events),
    signalSessionIntensity(events),
  ];

  // Weighted composite score
  const totalWeight = signals.reduce((s, sig) => s + sig.weight, 0);
  const pulseScore  = Math.round(
    signals.reduce((s, sig) => s + sig.score * sig.weight, 0) / totalWeight
  );

  // Dominant signal — highest weighted contribution
  const dominant = [...signals].sort((a, b) =>
    (b.score * b.weight) - (a.score * a.weight)
  )[0];

  // Trend
  const trend = buildTrend(buckets);
  const recentHalf = trend.slice(7);
  const earlierHalf = trend.slice(0, 7);
  const recentAvg  = recentHalf.reduce((s, v) => s + v, 0) / 7;
  const earlierAvg = earlierHalf.reduce((s, v) => s + v, 0) / 7;
  const trendDelta = Math.round(recentAvg - earlierAvg);
  const trendDirection = trendDelta > 5 ? "rising" : trendDelta < -5 ? "falling" : "stable";

  const sorted    = events.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const alertLevel =
    pulseScore >= 70 ? "critical" :
    pulseScore >= 50 ? "high" :
    pulseScore >= 25 ? "medium" : "low";

  return {
    student_id:      studentId,
    pulse_score:     pulseScore,
    trend,
    trend_direction: trendDirection,
    trend_delta:     trendDelta,
    dominant_signal: dominant,
    signals,
    total_events:    events.length,
    first_seen:      sorted[0]?.created_at ?? "",
    last_seen:       sorted[sorted.length - 1]?.created_at ?? "",
    alert_level:     alertLevel,
  };
}

export function calculateAllPulses(events: BeaconEvent[]): StudentPulse[] {
  const byStudent: Record<string, BeaconEvent[]> = {};
  events.forEach(e => {
    if (!byStudent[e.student_id]) byStudent[e.student_id] = [];
    byStudent[e.student_id].push(e);
  });

  return Object.entries(byStudent)
    .map(([id, evts]) => calculatePulse(id, evts))
    .sort((a, b) => b.pulse_score - a.pulse_score);
}

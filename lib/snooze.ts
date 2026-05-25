// Pulse snooze — Phase 3 step 3.
//
// The triage classifier consults this module before spending an LLM call:
// if a student is actively snoozed AND no override condition has fired, we
// skip the call and the student stays out of the queue. When an override
// fires (re-emergence, rapid escalation, real-time spike), the active snooze
// is marked broken_early and the LLM runs normally.

import type { StudentPulseV3 } from "./pulse_engine_v3";

export type SnoozeDuration = "24h" | "48h" | "7d" | "14d" | "until-change";

export interface PulseSnooze {
  id:                      string;
  school_id:               string;
  student_id:              string;
  snoozed_by:              string;
  snoozed_at:              string;
  expires_at:              string | null;
  duration_label:          SnoozeDuration | string;
  reason:                  string | null;
  broken_early:            boolean;
  broken_at:               string | null;
  broken_reason:           string | null;
  snooze_time_score:       number | null;
  snooze_time_alert_level: string | null;
}

export interface SnoozeDurationOption {
  value: SnoozeDuration;
  label: string;
  hours: number | null;   // null = "until something changes"
}

export const SNOOZE_DURATIONS: SnoozeDurationOption[] = [
  { value: "24h",          label: "24 hours",                hours: 24      },
  { value: "48h",          label: "48 hours",                hours: 48      },
  { value: "7d",           label: "7 days",                  hours: 24 * 7  },
  { value: "14d",          label: "14 days",                 hours: 24 * 14 },
  { value: "until-change", label: "Until something changes", hours: null    },
];

export function expiresAtFor(duration: SnoozeDuration, now: number = Date.now()): string | null {
  const opt = SNOOZE_DURATIONS.find(d => d.value === duration);
  if (!opt || opt.hours === null) return null;
  return new Date(now + opt.hours * 60 * 60 * 1000).toISOString();
}

// Pick the most recent active snooze per student. "Active" = not broken_early
// and not expired. Input list need not be filtered/sorted.
export function activeSnoozeFor(
  studentId: string,
  snoozes:   PulseSnooze[],
  now:       number = Date.now(),
): PulseSnooze | undefined {
  return snoozes
    .filter(s => s.student_id === studentId)
    .filter(s => !s.broken_early)
    .filter(s => !s.expires_at || new Date(s.expires_at).getTime() > now)
    .sort((a, b) => new Date(b.snoozed_at).getTime() - new Date(a.snoozed_at).getTime())[0];
}

// Override conditions checked before each scheduled LLM call. Returns a reason
// string when the snooze must be broken; null when the snooze should hold.
//
// The spec lists five overrides; we evaluate the four that can be determined
// from v3 engine output alone (re-emergence, rapid escalation, real-time
// spike via context_boost, alert_level critical as a "would-be urgent" proxy).
// The fifth override — "triage would be urgent" — can only be known after
// running the LLM, which is what we're trying to skip; the critical-alert
// proxy approximates it conservatively.
const ALERT_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function shouldBreakSnooze(pulse: StudentPulseV3, snooze: PulseSnooze): string | null {
  if (pulse.re_emergence) {
    return "Previously acknowledged pattern re-emerged";
  }
  if (pulse.rapid_escalation) {
    return "Rapid escalation in last 3 days";
  }
  // Only break for "critical" if the alert level has genuinely risen since
  // the snooze was created. Without this check, a student who was already at
  // critical when snoozed would have their snooze broken on every triage run.
  // Legacy rows with no baseline (snooze_time_alert_level = null) fall back to
  // the old behaviour and break — conservative until they get a new snooze.
  if (pulse.alert_level === "critical") {
    const baseline = snooze.snooze_time_alert_level;
    if (baseline !== null) {
      // We have a reference level — break only if it genuinely rose to critical.
      const baselineOrder = ALERT_ORDER[baseline] ?? 0;
      if (baselineOrder < ALERT_ORDER["critical"]) {
        return `Alert level rose to critical (score ${pulse.pulse_score})`;
      }
    }
    // Whether or not we have a level baseline, break for a meaningful score
    // spike (>10 points). If both baseline fields are null (snooze created
    // before migration 0008), this is the only check that fires — prevents
    // legacy snoozes from being broken on every run with no recourse.
    if (
      snooze.snooze_time_score !== null &&
      pulse.pulse_score > snooze.snooze_time_score + 10
    ) {
      return `Score escalated further since snooze (now ${pulse.pulse_score}, was ${snooze.snooze_time_score})`;
    }
  }
  // context_boost is clamped to >=0 specifically when the real-time layer
  // (layer 3) fires, so a non-negative boost on an otherwise-ack'd student
  // is a live spike signal worth surfacing.
  if (pulse.context_boost > 0 && pulse.alert_level !== "low") {
    return "Real-time spike detected in last 24h";
  }
  // Snooze-time category drift: a new dominant category appears that wasn't
  // the one this snooze covered. Only meaningful for "until-change" snoozes
  // — short fixed snoozes don't need this granularity.
  if (snooze.duration_label === "until-change") {
    const topCategoryNow = pulse.categories[0]?.name;
    const baselineCats = new Set(pulse.fingerprint.dominant_categories);
    if (topCategoryNow && !baselineCats.has(topCategoryNow)) {
      return `New dominant category: ${topCategoryNow}`;
    }
  }
  return null;
}

// Friendly label for the snooze badge in the UI.
export function snoozeLabel(snooze: PulseSnooze, now: number = Date.now()): string {
  if (!snooze.expires_at) return "Snoozed until change";
  const remainingMs = new Date(snooze.expires_at).getTime() - now;
  if (remainingMs <= 0) return "Snooze expired";
  const hours = Math.round(remainingMs / (60 * 60 * 1000));
  if (hours < 24) return `Snoozed · ${hours}h left`;
  const days = Math.round(hours / 24);
  return `Snoozed · ${days}d left`;
}

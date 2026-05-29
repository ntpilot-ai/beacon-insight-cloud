/**
 * Aegis → Pulse promotion rule (Phase 5).
 *
 * Beacon's UI splits into two surfaces:
 *   - Aegis = event-driven worklist. Every flagged beacon_event shows up
 *     here. High-volume, low-depth: "what just got flagged, what do I do
 *     about it?"
 *   - Pulse = student-driven pattern analysis. Only students whose
 *     activity warrants behavioural deep-dive show up. Low-volume,
 *     high-depth: "who do I need to be worried about?"
 *
 * This module decides which students cross from Aegis-only into Pulse.
 * Hybrid rule (Decision 1, design pass 2026-05-28): auto-promote on hard
 * thresholds + manual "Escalate to Pulse" button as override.
 *
 * Auto-promotion fires when ANY of:
 *   1. Engine alert_level >= medium                   (pattern is forming)
 *   2. Any single event of risk = high or critical    (severe one-off)
 *   3. Any blocked event                              (hit a hard guardrail)
 *   4. Carry-over from previous-term snapshot         (rule belongs to UI;
 *      the queue's carry-over filter already includes these — this helper
 *      doesn't need to re-check it)
 *
 * Manual promotion (rule 4 in the design pass) happens elsewhere — it
 * creates a pulse_acknowledgements row with action_taken='escalated',
 * which downstream surfaces interpret as "this student is on Pulse."
 * Once we have any ack at all for a student, they're in Pulse.
 *
 * Reading: pure helper. No engine logic, no Supabase calls. Takes the
 * pulse output and the student's events, returns a boolean + reason.
 */

import type { StudentPulseV3 } from "./pulse_engine_v3";

export interface PulseEligibility {
  appearsInPulse: boolean;
  // Why — useful for UI tooltips and audit logging. Empty when not appearing.
  reasons:        string[];
}

export interface PromotionInputs {
  pulse:  StudentPulseV3;
  // Student's events scoped to whatever window the caller cares about
  // (typically the current term, matching what the engine already saw).
  events: Array<{ risk: string; blocked?: boolean }>;
  // Whether the student has been manually escalated via any ack with
  // action_taken='escalated' or 'referred'. Caller derives this from
  // pulse_acknowledgements.
  hasEscalationAck?: boolean;
}

/**
 * Evaluate whether a student should appear on the Pulse queue. Returns
 * both the boolean (for filtering) and the reasons (for UI badge / audit).
 */
export function evaluatePulseEligibility({
  pulse,
  events,
  hasEscalationAck,
}: PromotionInputs): PulseEligibility {
  const reasons: string[] = [];

  // Rule 1 — engine alert_level >= medium (pattern is forming).
  // Order matters in the bands: low < medium < high < critical.
  if (pulse.alert_level === "medium" || pulse.alert_level === "high" || pulse.alert_level === "critical") {
    reasons.push(`engine alert: ${pulse.alert_level}`);
  }

  // Rule 2 — any single severe event.
  const hasSevere = events.some(e => e.risk === "high" || e.risk === "critical");
  if (hasSevere) reasons.push("severe event in term");

  // Rule 3 — any blocked event. Hit a hard guardrail, deserves a look.
  const hasBlock = events.some(e => e.blocked === true);
  if (hasBlock) reasons.push("blocked event in term");

  // Rule 4 (manual) — staff explicitly escalated via an ack.
  if (hasEscalationAck) reasons.push("manually escalated");

  return {
    appearsInPulse: reasons.length > 0,
    reasons,
  };
}

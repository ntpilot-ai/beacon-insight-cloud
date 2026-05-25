// Daily triage classifier — Phase 3 of the Pulse spec.
//
// Sits one layer above pulse_engine_v3. The engine produces a structured
// behavioural summary per student; this module formats that summary into the
// prompt the Haiku classifier sees, and defines the result shape stored in
// beacon_triage_results.
//
// No LLM calls happen here — those live in /api/triage/run. Keeping the
// builder pure means the same input snapshot we send to Haiku can be persisted
// for audit (input_snapshot column).

import type { BeaconEvent, StudentPulseV3, PulseAcknowledgement } from "./pulse_engine_v3";
import type { ConversationSession } from "./sessions";

export type TriageLevel = "silent_monitoring" | "low" | "medium" | "high" | "urgent";

export interface TriageResult {
  id?:                string;
  school_id:          string;
  student_id:         string;
  assessed_at:        string;
  triage:             TriageLevel;
  concern_summary:    string | null;
  suggested_action:   string | null;
  notify_immediately: boolean;
  reasoning:          string | null;
  input_snapshot:     string | null;
  model_version:      string | null;
  requested_by:       string | null;
}

const TWO_DAYS_MS  = 48 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7  * 24 * 60 * 60 * 1000;

// "Active" = at least one event in the last 48h. Matches the spec's gating
// rule: students with no recent activity get no LLM spend.
export function isActiveStudent(events: BeaconEvent[], now: number = Date.now()): boolean {
  const cutoff = now - TWO_DAYS_MS;
  return events.some(e => new Date(e.created_at).getTime() >= cutoff);
}

// System prompt for the triage classifier. Lifted directly from the design
// doc — staff-facing summary fields must avoid jargon and scores, internal
// reasoning field can use technical terms.
export const TRIAGE_SYSTEM_PROMPT = `You are a safeguarding triage assistant for Beacon, a school AI monitoring platform.
You will be given a structured summary of a student's recent AI interaction behaviour.
Your job is to determine whether this student requires staff attention today, and if so,
produce a plain-English reason and suggested action.

You must return JSON only. No preamble, no explanation outside the JSON structure.

Rules:
- Only recommend action if there is genuine cause for concern
- Do not flag students whose activity is stable and previously reviewed
- Re-emergence of a previously acknowledged pattern is always high priority
- Rapid escalation combined with deteriorating sentiment is always urgent
- When in doubt, prefer silent monitoring over unnecessary alerts
- Keep concern_summary to one sentence, written for a non-technical pastoral teacher
- Keep suggested_action specific and actionable, not generic
- Never reference scores or technical signal names in summary or action fields

Return this structure:
{
  "triage": "silent_monitoring" | "low" | "medium" | "high" | "urgent",
  "concern_summary": "string",
  "suggested_action": "string",
  "notify_immediately": boolean,
  "reasoning": "string"
}`;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function daysSince(iso: string, now: number = Date.now()): number {
  return Math.floor((now - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

// Format the per-student behavioural summary the classifier consumes. The
// returned string is also persisted on the TriageResult row as input_snapshot
// so we can audit what the LLM was actually shown.
export function buildTriagePrompt(opts: {
  pulse:    StudentPulseV3;
  sessions: ConversationSession<BeaconEvent>[];
  acks:     PulseAcknowledgement[];
  now?:     number;
}): string {
  const { pulse, sessions, acks } = opts;
  const now = opts.now ?? Date.now();

  const studentAcks = acks
    .filter(a => a.student_id === pulse.student_id)
    .sort((a, b) => new Date(b.acknowledged_at).getTime() - new Date(a.acknowledged_at).getTime());
  const lastAck = studentAcks[0];

  const lines: string[] = [];

  // ── Header summary ──
  lines.push("STUDENT BEHAVIOURAL SUMMARY");
  lines.push("============================");
  lines.push(`Student ID:        ${pulse.student_id}`);
  lines.push(`Assessment date:   ${new Date(now).toISOString().slice(0, 10)}`);
  lines.push(`Alert level:       ${pulse.alert_level}`);
  lines.push(`Pulse score:       ${pulse.pulse_score}`);
  lines.push(`Trend:             ${pulse.trend_direction} over last 7 days (delta ${pulse.trend_delta >= 0 ? "+" : ""}${pulse.trend_delta})`);
  lines.push(`Trend shape:       ${pulse.trend_shape}`);
  if (typeof pulse.vs_school_avg === "number") {
    const vs = pulse.vs_school_avg;
    lines.push(`vs school average: ${vs >= 0 ? "+" : ""}${vs} points`);
  }
  lines.push(`Last staff review: ${lastAck ? `${daysSince(lastAck.acknowledged_at, now)} days ago (${lastAck.action_taken})` : "never reviewed"}`);
  lines.push("");

  // ── Signal breakdown ──
  lines.push("SIGNAL BREAKDOWN");
  lines.push("================");
  lines.push(`Dominant signal:   ${pulse.dominant_signal?.label ?? "n/a"} — ${pulse.dominant_signal?.detail ?? ""}`);
  for (const sig of pulse.signals) {
    if (sig.id === pulse.dominant_signal?.id) continue;
    lines.push(`${sig.label.padEnd(18)} ${sig.score} — ${sig.detail}`);
  }
  lines.push("");

  // ── Category clusters ──
  lines.push("CATEGORY CLUSTERS (last 14 days)");
  lines.push("=================================");
  if (pulse.categories.length === 0) {
    lines.push("(no flagged categories)");
  } else {
    for (const c of pulse.categories) {
      lines.push(`${c.name}: ${c.count} incident${c.count !== 1 ? "s" : ""}`);
    }
  }
  lines.push("");

  // ── Recent sessions ──
  const recentSessions = sessions
    .filter(s => s.student_id === pulse.student_id)
    .filter(s => new Date(s.ended_at).getTime() >= now - SEVEN_DAYS_MS)
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    .slice(0, 10);

  lines.push("RECENT SESSIONS (last 7 days)");
  lines.push("==============================");
  if (recentSessions.length === 0) {
    lines.push("(none)");
  } else {
    for (const s of recentSessions) {
      const high   = s.events.filter(e => e.risk === "high" || e.risk === "critical").length;
      const medium = s.events.filter(e => e.risk === "medium").length;
      lines.push(`Session ${fmtDate(s.started_at)} ${s.platform}`);
      lines.push(`  Trigger: ${s.has_trigger ? `yes — risk ${s.trigger_event?.risk ?? "?"}${s.trigger_event?.blocked ? ", blocked" : ""}` : "no"}`);
      lines.push(`  Events: ${s.events.length} total, ${high} high/critical, ${medium} medium`);
      if (s.sentiment) {
        lines.push(`  Sentiment: ${s.sentiment.score.toFixed(2)} | trend: ${s.sentiment.trend}`);
      }
      lines.push(`  Requires review: ${s.requires_review ? "yes" : "no"}`);
      lines.push(`  LLM analysis: ${s.llm_requested_at ? (s.semantic_summary ?? "(run, no summary)") : "not run"}`);
    }
  }
  lines.push("");

  // ── Acknowledgement history ──
  lines.push("ACKNOWLEDGEMENT HISTORY");
  lines.push("========================");
  if (studentAcks.length === 0) {
    lines.push("(none on record)");
  } else {
    for (const a of studentAcks.slice(0, 5)) {
      lines.push(`${fmtDate(a.acknowledged_at)} — ${a.action_taken} — reviewed by ${a.acknowledged_by}`);
    }
  }
  lines.push("");

  // ── Re-emergence ──
  lines.push("RE-EMERGENCE");
  lines.push("============");
  lines.push(`Previously acknowledged pattern detected: ${pulse.re_emergence ? "yes" : "no"}`);
  if (pulse.re_emergence && lastAck?.dominant_category) {
    lines.push(`Category: ${lastAck.dominant_category}`);
    lines.push(`Last acknowledged: ${fmtDate(lastAck.acknowledged_at)} (${daysSince(lastAck.acknowledged_at, now)} days ago)`);
  }
  lines.push("");

  // ── Snooze status (placeholder until Phase 3 step 3) ──
  lines.push("SNOOZE STATUS");
  lines.push("=============");
  lines.push("Currently snoozed: no");
  lines.push("(snooze feature not yet implemented)");

  return lines.join("\n");
}

// Parse a Haiku reply (raw text) into a TriageResult-shaped object. Tolerant
// of markdown fences and missing fields — defaults conservatively to
// silent_monitoring rather than upgrading anything we can't confidently parse.
export function parseTriageVerdict(raw: string): {
  triage:             TriageLevel;
  concern_summary:    string | null;
  suggested_action:   string | null;
  notify_immediately: boolean;
  reasoning:          string | null;
} {
  const text = raw.replace(/```json|```/g, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      triage:             "silent_monitoring",
      concern_summary:    null,
      suggested_action:   null,
      notify_immediately: false,
      reasoning:          "Could not parse LLM output as JSON",
    };
  }

  const triageValues: TriageLevel[] = ["silent_monitoring", "low", "medium", "high", "urgent"];
  const triage: TriageLevel = triageValues.includes(parsed.triage) ? parsed.triage : "silent_monitoring";

  return {
    triage,
    concern_summary:    typeof parsed.concern_summary  === "string" ? parsed.concern_summary.slice(0, 500)  : null,
    suggested_action:   typeof parsed.suggested_action === "string" ? parsed.suggested_action.slice(0, 500) : null,
    notify_immediately: !!parsed.notify_immediately,
    reasoning:          typeof parsed.reasoning        === "string" ? parsed.reasoning.slice(0, 1000)       : null,
  };
}

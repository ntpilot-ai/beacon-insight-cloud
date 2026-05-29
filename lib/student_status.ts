/**
 * Workflow-state derivation for a student in the safeguarding queue.
 *
 * Beacon's data model captures *engine-derived* concern (Pulse score, alert
 * level, snapshot history) but the staff-facing question is workflow:
 * "what stage is this case in MY queue?" Status answers that — derived from
 * the existing acknowledgement and snooze rows, no schema changes needed.
 *
 * Used by:
 *   - Dashboard "Recent Safeguarding Events" widget (app/page.tsx)
 *   - Pulse-beta queue Status column
 * so both surfaces share the same verb-set and rules.
 */

export type StudentStatus = "new" | "monitoring" | "in_review" | "escalated" | "closed";

export interface StatusInputs {
  studentId:  string;
  firstSeen?: string;         // ISO — pulse.first_seen, used for "New" detection
  acks?:      ReadonlyArray<{ student_id: string; acknowledged_at: string; action_taken: string }>;
  snoozes?:   ReadonlyArray<{ student_id: string; expires_at: string | null; broken_early: boolean }>;
  now?:       number;         // override for deterministic tests
}

const DAY_MS = 86400000;

// How fresh "New" is. Anything younger than this with no engagement reads as
// New rather than Monitoring — staff haven't had a chance to look yet.
const NEW_WINDOW_MS = DAY_MS;

// How long an ack-resolved case stays Closed before its absence from acks
// would otherwise re-classify it. We don't currently have a closure verb in
// action_taken, so this constant is reserved for when that lands.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CLOSED_LOOKBACK_MS = 30 * DAY_MS;

/**
 * Status priority for the workflow:
 *   escalated  — most recent ack is referred/escalated
 *   in_review  — has an active snooze OR has an ack of any other kind
 *   monitoring — in the queue (i.e. has a pulse) with no engagement yet
 *   new        — first seen in last 24h with no engagement
 *   closed     — reserved (no closure verb in the data model yet)
 */
export function deriveStudentStatus(inputs: StatusInputs): StudentStatus {
  const now = inputs.now ?? Date.now();

  const studentAcks = (inputs.acks ?? [])
    .filter(a => a.student_id === inputs.studentId)
    .sort((a, b) => new Date(b.acknowledged_at).getTime() - new Date(a.acknowledged_at).getTime());
  const lastAck = studentAcks[0];

  const studentSnoozes = (inputs.snoozes ?? []).filter(s => s.student_id === inputs.studentId);
  const hasActiveSnooze = studentSnoozes.some(s => {
    if (s.broken_early) return false;
    if (!s.expires_at)  return true;
    return new Date(s.expires_at).getTime() > now;
  });

  if (lastAck && (lastAck.action_taken === "referred" || lastAck.action_taken === "escalated")) {
    return "escalated";
  }
  if (hasActiveSnooze) return "in_review";
  if (lastAck)         return "in_review";

  if (inputs.firstSeen) {
    const firstMs = new Date(inputs.firstSeen).getTime();
    if (now - firstMs < NEW_WINDOW_MS) return "new";
  }

  return "monitoring";
}

// Display styling for the status chip. Kept in this module so both surfaces
// render identically. Plain Tailwind classes — no design-system dependencies.
export const STATUS_STYLE: Record<StudentStatus, { label: string; chip: string; dot: string }> = {
  escalated:  { label: "Escalated",  chip: "bg-red-100   text-red-700",    dot: "bg-red-500"     },
  in_review:  { label: "In Review",  chip: "bg-amber-100 text-amber-700",  dot: "bg-amber-500"   },
  monitoring: { label: "Monitoring", chip: "bg-cyan-50   text-cyan-700",   dot: "bg-cyan-500"    },
  new:        { label: "New",        chip: "bg-slate-100 text-slate-700",  dot: "bg-slate-500"   },
  closed:     { label: "Closed",     chip: "bg-slate-50  text-slate-400",  dot: "bg-slate-300"   },
};

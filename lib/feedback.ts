// False-positive feedback — Brief 3.
//
// Staff mark triage alerts as "not a concern" from the queue UI. Each
// submission creates a pulse_feedback row for audit + calibration, and a
// student_signal_suppression row that reduces the weight of the misfiring
// signal for 7 days of triage-only scoring.

export type FeedbackReason =
  | "known_student"
  | "sentiment_misread"
  | "keyword_irrelevant"
  | "other";

export interface PulseFeedback {
  id:              string;
  school_id:       string;
  student_id:      string;
  triage_id:       string;
  submitted_by:    string;
  submitted_at:    string;
  reason:          FeedbackReason;
  notes?:          string | null;
  signal_context:  string[];
  sentiment_trend: string | null;
  category:        string | null;
}

export interface StudentSignalSuppression {
  id:          string;
  school_id:   string;
  student_id:  string;
  signal_id:   string | null;
  category:    string | null;
  factor:      number;
  expires_at:  string;
  reason:      string | null;
  feedback_id: string | null;
}

export interface FeedbackReasonOption {
  value:      FeedbackReason;
  label:      string;
  suppresses: string | null;   // signal_id to suppress; null = all signals
}

// Maps each reason to the signal whose score is halved for 7 days.
// "known_student" and "other" suppress all signals (null = all).
export const FEEDBACK_REASONS: FeedbackReasonOption[] = [
  {
    value:      "known_student",
    label:      "This student is known to staff — activity is expected",
    suppresses: null,
  },
  {
    value:      "sentiment_misread",
    label:      "Sentiment misread — context was not distressing",
    suppresses: "conversational_context",
  },
  {
    value:      "keyword_irrelevant",
    label:      "Keyword match was not relevant in context",
    suppresses: "escalation",
  },
  {
    value:      "other",
    label:      "Other",
    suppresses: null,
  },
];

export function signalForReason(reason: FeedbackReason): string | null {
  return FEEDBACK_REASONS.find(r => r.value === reason)?.suppresses ?? null;
}

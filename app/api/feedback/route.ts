import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { signalForReason, type FeedbackReason } from "@/lib/feedback";

const SUPPRESSION_DAYS   = 7;
const VALID_REASONS: FeedbackReason[] = [
  "known_student", "sentiment_misread", "keyword_irrelevant", "other",
];

/**
 * POST /api/feedback
 *
 * Submits a "not a concern" false-positive flag for a triage result. Creates:
 *   1. A pulse_feedback row for audit + calibration aggregation.
 *   2. A student_signal_suppression row (expires 7 days from now) that
 *      reduces the weight of the misfiring signal in subsequent triage runs.
 *
 * Body:
 *   {
 *     school_id?:      string,
 *     student_id:      string,
 *     triage_id:       string,   // beacon_triage_results.id
 *     submitted_by:    string,
 *     reason:          FeedbackReason,
 *     notes?:          string,
 *     signal_context:  string[], // pulse signal IDs at submission time
 *     sentiment_trend?: string,
 *     category?:       string,   // dominant category at submission time
 *   }
 */
export async function POST(req: NextRequest) {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supaUrl || !supaKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    school_id      = "beacon-academy",
    student_id,
    triage_id,
    submitted_by,
    reason,
    notes,
    signal_context = [],
    sentiment_trend,
    category,
  } = body;

  if (!student_id || !triage_id || !submitted_by || !reason) {
    return NextResponse.json({ error: "Missing required fields: student_id, triage_id, submitted_by, reason" }, { status: 400 });
  }
  if (!VALID_REASONS.includes(reason)) {
    return NextResponse.json({ error: `Invalid reason. Must be one of: ${VALID_REASONS.join(", ")}` }, { status: 400 });
  }

  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
  const now       = Date.now();
  const expiresAt = new Date(now + SUPPRESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: feedback, error: fbErr } = await supabase
    .from("pulse_feedback")
    .insert({
      school_id,
      student_id,
      triage_id,
      submitted_by,
      reason,
      notes:           notes ? String(notes).slice(0, 500) : null,
      signal_context:  Array.isArray(signal_context) ? signal_context : [],
      sentiment_trend: sentiment_trend ?? null,
      category:        category ?? null,
    })
    .select()
    .single();

  if (fbErr) {
    return NextResponse.json({ error: fbErr.message }, { status: 500 });
  }

  const suppressSignalId = signalForReason(reason as FeedbackReason);
  const { error: supErr } = await supabase
    .from("student_signal_suppression")
    .insert({
      school_id,
      student_id,
      signal_id:   suppressSignalId,
      category:    reason === "keyword_irrelevant" ? (category ?? null) : null,
      factor:      0.3,
      expires_at:  expiresAt,
      reason,
      feedback_id: feedback.id,
    });

  if (supErr) {
    return NextResponse.json(
      { error: `Feedback saved but suppression failed: ${supErr.message}`, feedback_id: feedback.id },
      { status: 500 },
    );
  }

  return NextResponse.json({ status: "ok", feedback_id: feedback.id });
}

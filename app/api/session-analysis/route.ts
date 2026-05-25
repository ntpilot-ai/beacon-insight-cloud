import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scoreSessionSentiment } from "@/lib/sentiment";

/**
 * POST /api/session-analysis
 *
 * Sentiment pre-filter only. Always cheap, always local. Stores one row per
 * settled triggered session, with `escalated_to_llm` set based on the
 * sentiment verdict. The LLM semantic pass is NEVER triggered from here —
 * it is teacher-initiated via /api/session-analysis/run-llm so a human owns
 * the decision to invoke AI summarisation.
 *
 * Idempotent via the session_id primary key.
 *
 * Body:
 *   {
 *     session_id, school_id, student_id, platform,
 *     started_at, ended_at,
 *     events:              [{ created_at, prompt, risk, blocked, matched? }],
 *     post_trigger_events: [{ created_at, prompt, ... }]  // optional, derived if absent
 *   }
 */

export async function POST(req: NextRequest) {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supaUrl || !supaKey) {
    return NextResponse.json({ error: "Required env vars not configured" }, { status: 500 });
  }

  const body = await req.json();
  const {
    session_id, school_id, student_id, platform, started_at, ended_at,
    events, post_trigger_events,
  } = body || {};

  if (!session_id || !student_id || !platform || !Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // Dedup: skip if already scored.
  const existing = await supabase
    .from("beacon_session_analysis")
    .select("session_id")
    .eq("session_id", session_id)
    .maybeSingle();
  if (existing.data) {
    return NextResponse.json({ status: "exists" });
  }

  // Identify post-trigger events: explicit from client, else derive by finding
  // the first triggered event in the thread and taking what follows.
  const postTrigger: any[] = Array.isArray(post_trigger_events) && post_trigger_events.length > 0
    ? post_trigger_events
    : (() => {
        const idx = events.findIndex((e: any) =>
          e.blocked || e.risk === "medium" || e.risk === "high" || e.risk === "critical");
        return idx >= 0 ? events.slice(idx + 1) : [];
      })();

  const sentiment = scoreSessionSentiment(postTrigger.map((e: any) => ({ prompt: String(e.prompt ?? "") })));

  // Structural safeguarding gates layered on top of sentiment. The AFINN-based
  // sentiment package is too blunt for grooming/threat language, retry-after-
  // block, single-prompt high-risk events, or quietly escalating dialogue —
  // these are loud behavioural signals that should always escalate regardless
  // of word-list scoring.
  const triggerEvent = events.find((e: any) =>
    e.blocked || e.risk === "medium" || e.risk === "high" || e.risk === "critical");
  const triggerIsHigh =
    !!triggerEvent
    && (triggerEvent.blocked
        || triggerEvent.risk === "high"
        || triggerEvent.risk === "critical");
  const anyPostTriggerBlocked = postTrigger.some((e: any) => !!e.blocked);
  const anyPostTriggerHigh    = postTrigger.some((e: any) =>
    e.risk === "high" || e.risk === "critical");

  const escalate =
       sentiment.escalate_to_llm
    || triggerIsHigh
    || anyPostTriggerBlocked
    || anyPostTriggerHigh;

  const row = {
    session_id,
    school_id:          school_id || "beacon-academy",
    student_id,
    platform,
    started_at,
    ended_at,
    event_count:        events.length,
    sentiment_score:    sentiment.score,
    sentiment_messages: sentiment.arc,
    sentiment_trend:    sentiment.trend,
    escalated_to_llm:   escalate,
    model_version:      "sentiment-only",
  };

  const insert = await supabase
    .from("beacon_session_analysis")
    .insert(row)
    .select()
    .single();

  if (insert.error) {
    if (insert.error.code === "23505") return NextResponse.json({ status: "exists" });
    return NextResponse.json({ error: "Insert failed", detail: insert.error.message }, { status: 500 });
  }

  return NextResponse.json({
    status: escalate ? "flagged_for_review" : "monitored",
    analysis: insert.data,
  });
}

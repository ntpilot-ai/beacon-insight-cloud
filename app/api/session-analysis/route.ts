import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scoreSessionSentiment } from "@/lib/sentiment";

/**
 * POST /api/session-analysis
 *
 * Two-stage pipeline for a triggered, settled conversation session:
 *
 *   1. Sentiment pre-filter (local, rule-based) on the post-trigger window.
 *      Always stored against the session.
 *   2. LLM semantic pass via Claude Haiku — only runs when sentiment escalates
 *      (negative aggregate, deteriorating trend, or volatile swings).
 *
 * Idempotent via the session_id primary key.
 *
 * Body:
 *   {
 *     session_id, school_id, student_id, platform,
 *     started_at, ended_at,
 *     events:              [{ created_at, prompt, risk, blocked, matched? }],
 *     post_trigger_events: [{ created_at, prompt, risk, blocked, matched? }]  // optional, derived if absent
 *   }
 */

const ARC_VALUES  = ["escalating", "de-escalating", "stable", "unresolved"] as const;
const RISK_VALUES = ["high", "medium", "low"] as const;

export async function POST(req: NextRequest) {
  const apiKey  = process.env.ANTHROPIC_API_KEY;
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Service key bypasses RLS in prod; fall back to anon in dev where the
  // service key may not be set (RLS policies on beacon_session_analysis
  // already allow anon writes — see 0002 migration).
  const supaKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!apiKey || !supaUrl || !supaKey) {
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

  // Dedup: skip everything if this session is already in the table.
  const existing = await supabase
    .from("beacon_session_analysis")
    .select("session_id")
    .eq("session_id", session_id)
    .maybeSingle();
  if (existing.data) {
    return NextResponse.json({ status: "exists" });
  }

  // ── Stage 1: sentiment pre-filter ────────────────────────────────────────
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

  const sentimentRow = {
    session_id,
    school_id:           school_id || "beacon-academy",
    student_id,
    platform,
    started_at,
    ended_at,
    event_count:         events.length,
    sentiment_score:     sentiment.score,
    sentiment_messages:  sentiment.arc,
    sentiment_trend:     sentiment.trend,
    escalated_to_llm:    sentiment.escalate_to_llm,
  };

  if (!sentiment.escalate_to_llm) {
    // Sentiment-only row. LLM verdict columns left null. No Haiku call.
    const insert = await supabase
      .from("beacon_session_analysis")
      .insert({ ...sentimentRow, model_version: "sentiment-only" })
      .select()
      .single();
    if (insert.error) {
      if (insert.error.code === "23505") return NextResponse.json({ status: "exists" });
      return NextResponse.json({ error: "Insert failed", detail: insert.error.message }, { status: 500 });
    }
    return NextResponse.json({ status: "sentiment_only", analysis: insert.data });
  }

  // ── Stage 2: LLM semantic pass (only when sentiment escalates) ──────────

  // Build the conversation thread for the analyst. Trim each prompt so a
  // pathological single message can't blow the context budget.
  const thread = events.map((e: any, i: number) => {
    const meta = `(${e.risk ?? "?"}${e.blocked ? ", blocked" : ""})`;
    const text = String(e.prompt ?? "").slice(0, 600);
    return `[${i + 1}] ${meta} ${text}`;
  }).join("\n");

  const systemPrompt = `You are Beacon's session-context analyser. A safeguarding keyword trigger was detected in this student's AI conversation. Read the FULL conversation thread that followed and assess the behavioural arc.

Respond ONLY with a JSON object, no markdown:
{
  "context_risk": "high" | "medium" | "low",
  "sentiment_arc": "escalating" | "de-escalating" | "stable" | "unresolved",
  "concern_summary": "one sentence describing what's happening in this session",
  "requires_review": boolean,
  "reasoning": "brief explanation of your verdict",
  "behavioural_indicators": ["short tags, e.g. victim disclosure, help-seeking, deflection, distress"]
}

Important definitions:
- context_risk reflects the HOLISTIC safeguarding concern, independent of whether individual messages match keywords. A student calmly disclosing victimisation is high context_risk even if no individual message would itself trigger Aegis.
- sentiment_arc is the trajectory across the session: escalating = concern grew, de-escalating = concern eased, stable = flat, unresolved = the conversation ended mid-issue without closure or de-escalation.
- requires_review = true if a member of safeguarding staff should look at this session today.
- behavioural_indicators are short labels describing what is visible in the dialogue.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system:     systemPrompt,
      messages:   [{ role: "user", content: thread }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return NextResponse.json({ error: "LLM call failed", detail: detail.slice(0, 500) }, { status: 502 });
  }

  const data = await response.json();
  const text = data.content?.map((c: any) => c.text ?? "").join("") ?? "";

  let parsed: any;
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return NextResponse.json({ error: "Could not parse LLM output", raw: text.slice(0, 500) }, { status: 502 });
  }

  const contextRisk  = RISK_VALUES.includes(parsed.context_risk)  ? parsed.context_risk  : "low";
  const sentimentArc = ARC_VALUES.includes(parsed.sentiment_arc) ? parsed.sentiment_arc : "stable";

  const row = {
    ...sentimentRow,
    context_risk:           contextRisk,
    sentiment_arc:          sentimentArc,
    concern_summary:        typeof parsed.concern_summary === "string" ? parsed.concern_summary.slice(0, 500) : null,
    requires_review:        !!parsed.requires_review,
    reasoning:              typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 1000) : null,
    behavioural_indicators: Array.isArray(parsed.behavioural_indicators)
                              ? parsed.behavioural_indicators.map((s: any) => String(s).slice(0, 80)).slice(0, 12)
                              : [],
    model_version:          "claude-haiku-4-5",
  };

  const insert = await supabase
    .from("beacon_session_analysis")
    .insert(row)
    .select()
    .single();

  if (insert.error) {
    // Race: another tab already inserted this session_id between our SELECT
    // and INSERT. That's the dedup working — return the existing row instead
    // of failing the request.
    if (insert.error.code === "23505") {
      const again = await supabase
        .from("beacon_session_analysis")
        .select("*")
        .eq("session_id", session_id)
        .single();
      return NextResponse.json({ status: "exists", analysis: again.data });
    }
    return NextResponse.json({ error: "Insert failed", detail: insert.error.message }, { status: 500 });
  }

  return NextResponse.json({ status: "analyzed", analysis: insert.data });
}

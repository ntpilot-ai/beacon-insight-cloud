import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/session-analysis/run-llm
 *
 * Teacher-initiated LLM semantic pass on a flagged session. The /api/session-
 * analysis sentiment pre-filter must have run on this session_id first, and
 * the LLM cannot have already run (this endpoint refuses to re-run for the
 * same session). Audit trail: llm_requested_by + llm_requested_at recorded.
 *
 * Body:
 *   {
 *     session_id, requested_by,
 *     events: [{ created_at, prompt, risk, blocked, matched? }]
 *   }
 */

const ARC_VALUES  = ["escalating", "de-escalating", "stable", "unresolved"] as const;
const RISK_VALUES = ["high", "medium", "low"] as const;

export async function POST(req: NextRequest) {
  const apiKey  = process.env.ANTHROPIC_API_KEY;
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!apiKey || !supaUrl || !supaKey) {
    return NextResponse.json({ error: "Required env vars not configured" }, { status: 500 });
  }

  const body = await req.json();
  const { session_id, requested_by, events } = body || {};

  if (!session_id || !requested_by || !Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // Sentiment row must exist (so we have audit fields to update onto) and
  // the LLM cannot have already been run for this session.
  const existing = await supabase
    .from("beacon_session_analysis")
    .select("session_id,escalated_to_llm,llm_requested_at")
    .eq("session_id", session_id)
    .maybeSingle();

  if (existing.error) {
    return NextResponse.json({ error: "Lookup failed", detail: existing.error.message }, { status: 500 });
  }
  if (!existing.data) {
    return NextResponse.json({ error: "Session not found — run sentiment pre-filter first" }, { status: 404 });
  }
  if (existing.data.llm_requested_at) {
    return NextResponse.json({ error: "LLM analysis already run for this session", analysis: existing.data }, { status: 409 });
  }
  if (!existing.data.escalated_to_llm) {
    return NextResponse.json({ error: "Session was not flagged by sentiment pre-filter — LLM analysis not warranted" }, { status: 400 });
  }

  // Build the conversation thread for the analyst.
  const thread = events.map((e: any, i: number) => {
    const meta = `(${e.risk ?? "?"}${e.blocked ? ", blocked" : ""})`;
    const text = String(e.prompt ?? "").slice(0, 600);
    return `[${i + 1}] ${meta} ${text}`;
  }).join("\n");

  const systemPrompt = `You are Beacon's session-context analyser. A staff member has manually requested AI analysis of a student session that was flagged for review. Read the FULL conversation thread and assess the behavioural arc.

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
- context_risk reflects the HOLISTIC safeguarding concern, independent of whether individual messages match keywords.
- sentiment_arc is the trajectory across the session.
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

  const patch = {
    context_risk:           contextRisk,
    sentiment_arc:          sentimentArc,
    concern_summary:        typeof parsed.concern_summary === "string" ? parsed.concern_summary.slice(0, 500) : null,
    requires_review:        !!parsed.requires_review,
    reasoning:              typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 1000) : null,
    behavioural_indicators: Array.isArray(parsed.behavioural_indicators)
                              ? parsed.behavioural_indicators.map((s: any) => String(s).slice(0, 80)).slice(0, 12)
                              : [],
    model_version:          "claude-haiku-4-5",
    llm_requested_by:       String(requested_by).slice(0, 200),
    llm_requested_at:       new Date().toISOString(),
  };

  const update = await supabase
    .from("beacon_session_analysis")
    .update(patch)
    .eq("session_id", session_id)
    .select()
    .single();

  if (update.error) {
    return NextResponse.json({ error: "Update failed", detail: update.error.message }, { status: 500 });
  }

  return NextResponse.json({ status: "analyzed", analysis: update.data });
}

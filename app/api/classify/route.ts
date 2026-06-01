import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/classify
 * Classifies a prompt using Claude Haiku — fast and cheap (~$0.001 per call).
 * Called by the extension background.js before sending telemetry.
 */

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const { prompt, keywords } = await req.json();
  if (!prompt) {
    return NextResponse.json({ error: "No prompt provided" }, { status: 400 });
  }

  const keywordContext = keywords
    ? `\nThe school has also flagged these keywords — treat matches as additional signal but don't rely solely on them:\nHigh risk: ${keywords.highRisk?.join(", ")}\nMedium risk: ${keywords.mediumRisk?.join(", ")}`
    : "";

  const systemPrompt = `You are a school safeguarding AI. Classify student prompts sent to AI tools.

Respond ONLY with a JSON object, no markdown:
{
  "risk": "low" | "medium" | "high",
  "category": "academic_integrity" | "self_harm" | "violence" | "bullying" | "inappropriate_content" | "substance" | "radicalization" | "jailbreak" | "general",
  "reason": "one short sentence explaining the classification"
}

Risk levels:
- high: immediate danger to self or others, explicit harmful intent, blocked content
- medium: concerning but not immediately dangerous, warrants monitoring and warning  
- low: normal academic use, curiosity, homework help, creative writing${keywordContext}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system:     systemPrompt,
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Classification failed" }, { status: 500 });
  }

  const data  = await response.json();
  const text  = data.content?.map((c: any) => c.text ?? "").join("") ?? "";

  try {
    const clean  = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ risk: "low", category: "general", reason: "Parse error" });
  }
}

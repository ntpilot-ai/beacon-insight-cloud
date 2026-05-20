import { NextRequest, NextResponse } from "next/server";
import { SCHOOL_NAME } from "@/lib/config";

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const { events } = await req.json();

  if (!events?.length) {
    return NextResponse.json({ error: "No events provided" }, { status: 400 });
  }

  const recentEvents = events.slice(0, 30).map((e: any) => ({
    student:  e.student_id,
    risk:     e.risk,
    platform: e.platform,
    matched:  e.matched?.join(", ") ?? "",
    prompt:   e.prompt?.slice(0, 80),
    time:     e.created_at,
  }));

  const high      = events.filter((e: any) => e.risk === "high" || e.risk === "critical").length;
  const medium    = events.filter((e: any) => e.risk === "medium").length;
  const platforms = [...new Set(events.map((e: any) => e.platform))].join(", ");

  const prompt = `You are a school safeguarding AI assistant for ${SCHOOL_NAME}. Analyse this data from Beacon, a real-time AI monitoring platform for schools.

Summary stats:
- Total events: ${events.length}
- High/critical risk: ${high}
- Medium risk: ${medium}
- Platforms in use: ${platforms}

Recent flagged events (up to 30):
${JSON.stringify(recentEvents, null, 2)}

Respond ONLY with a JSON object in this exact format, no markdown, no preamble:
{
  "summary": "2-3 sentence natural language summary of the key patterns and concerns you notice across the student body. Be specific about risk types and platforms.",
  "suggestion": "One clear, actionable suggested next step for the safeguarding team."
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":         "application/json",
      "x-api-key":            apiKey,
      "anthropic-version":    "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-5",
      max_tokens: 1000,
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return NextResponse.json({ error: err }, { status: response.status });
  }

  const data = await response.json();
  const text = data.content?.map((c: any) => c.text ?? "").join("") ?? "";

  try {
    const clean  = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({ error: "Failed to parse AI response", raw: text }, { status: 500 });
  }
}

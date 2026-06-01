import { NextRequest, NextResponse } from "next/server";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

// Mirrors DEFAULT_SUBJECTS in app/horizon/_lib/types.ts.
// Hard-coded here to keep the API route self-contained and avoid pulling
// client-only modules into a server route.
const SUBJECTS = [
  "English", "Maths", "Science", "History", "Geography",
  "Computing", "Languages", "Art", "Other",
] as const;

const SYSTEM_PROMPT = `You generate concise titles and subject classifications for student note saves in a school learning workspace.

You receive:
- An AI reply the student wants to save to their notes
- (optionally) the student's preceding question
- (optionally) the chat session's auto-generated title

Return ONLY a JSON object: { "title": string, "subject": string }

Rules:
- title: 3–6 words. No quotes, no trailing punctuation, no emoji. Should describe the TOPIC, not the exchange. Examples: "Kinetic energy and falling balls", "Causes of World War One", "Solving quadratic equations". Sentence case.
- subject: must be EXACTLY one of: ${SUBJECTS.join(", ")}. Pick the closest match. Use "Other" only when no academic subject fits at all (e.g. study technique, personal organisation).
- No prose, no commentary, no code fences. Just the JSON object.`;

interface NoteMetaResponse {
  title:   string;
  subject: string;
}

const FALLBACK: NoteMetaResponse = { title: "", subject: "Other" };

export async function POST(req: NextRequest) {
  try {
    if (!ANTHROPIC_API_KEY) {
      // Local dev without a key — return empty so the client uses its
      // heuristic title and inferred-subject defaults.
      return NextResponse.json(FALLBACK);
    }

    const { aiContent, userQuestion, sessionTitle } = await req.json();
    if (!aiContent || typeof aiContent !== "string") {
      return NextResponse.json({ error: "missing aiContent" }, { status: 400 });
    }

    const userMsg = [
      userQuestion ? `Student question: ${userQuestion}` : null,
      sessionTitle ? `Chat session title: ${sessionTitle}` : null,
      `AI reply to save:\n${aiContent.slice(0, 4000)}`,
    ].filter(Boolean).join("\n\n");

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: "user", content: userMsg }],
      }),
    });

    if (!claudeRes.ok) {
      console.warn("note-meta: Claude API non-OK", claudeRes.status);
      return NextResponse.json(FALLBACK);
    }

    const data = await claudeRes.json();
    const text = data.content?.[0]?.text ?? "";

    // Tolerant parse — strip code fences if the model added them anyway.
    let parsed: Partial<NoteMetaResponse> = {};
    try {
      const cleaned = text
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.warn("note-meta: failed to parse model JSON", { text });
    }

    const title = String(parsed.title || "")
      .trim()
      .replace(/^["'`]|["'`]$/g, "")
      .replace(/[.!?]+$/, "")
      .slice(0, 80);

    const subjectRaw = String(parsed.subject || "Other").trim();
    const subject = (SUBJECTS as readonly string[]).includes(subjectRaw) ? subjectRaw : "Other";

    return NextResponse.json({ title, subject });
  } catch (err) {
    console.error("note-meta: unexpected error", err);
    return NextResponse.json(FALLBACK);
  }
}

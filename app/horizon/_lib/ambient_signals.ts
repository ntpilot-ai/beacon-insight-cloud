/**
 * Ambient signal content module.
 *
 * Per ambient-social-v1-spec.md: v1 ONLY uses general educational truth —
 * statements that are honest because they are true about the subject/task,
 * NOT claimed presence or headcounts.
 *
 * Hard rules baked in here:
 * - No "N people are studying this"
 * - No "X% of students struggled with this"
 * - No live-presence claims of any kind
 * - Compare student to the task, never to named or counted peers
 * - Peer-level, matter-of-fact tone — no cheerleader, no character voice
 *
 * Seam: this file implements AmbientSignalProvider. A later layer (examiner
 * reports, real Horizon usage aggregates once density exists) plugs in
 * behind the same interface without touching the UI or the gate.
 */

export type TriggerReason = "repeated" | "frustration" | "difficult_topic";

export interface AmbientContext {
  subjectHint?:    string;       // e.g. "Maths", "Science", "English"
  difficultyHint?: string;       // narrower tag if available (rarely used in v1)
  triggerReason:   TriggerReason;
}

export interface AmbientSignal {
  id:     string;
  text:   string;
  source: "general" | "subject" | "external" | "aggregate";
}

export interface AmbientSignalProvider {
  pick(ctx: AmbientContext, recentlyShownIds: string[]): AmbientSignal | null;
}

// ── v1 content: general-truth lines ──────────────────────────────────────────
const GENERAL: AmbientSignal[] = [
  { id: "gen-1", source: "general", text: "This is one of those topics that trips a lot of people up — worth taking slowly." },
  { id: "gen-2", source: "general", text: "Tricky bit, this. No shame in working through it more than once." },
  { id: "gen-3", source: "general", text: "Worth slowing down here — this kind of thing rewards patience over speed." },
  { id: "gen-4", source: "general", text: "If this hasn't quite clicked yet, that's fair — it's one of the harder ideas in the area." },
  { id: "gen-5", source: "general", text: "Lots of people stumble on this exact point — it's not an obvious thing to miss." },
  { id: "gen-6", source: "general", text: "Worth re-reading the last bit. This kind of step often needs a second pass." },
];

// Subject-flavoured lines. Kept short on purpose — restraint is the feature.
const BY_SUBJECT: Record<string, AmbientSignal[]> = {
  Maths: [
    { id: "math-1", source: "subject", text: "Maths often makes sense the second time through more than the first — give it another pass." },
    { id: "math-2", source: "subject", text: "When the algebra stops making sense, it's usually one earlier step doing the damage. Worth checking the line above." },
    { id: "math-3", source: "subject", text: "This kind of question rewards writing each step out, even the boring ones." },
  ],
  Science: [
    { id: "sci-1",  source: "subject", text: "Science definitions look small but carry a lot of weight — worth being precise on the exact wording." },
    { id: "sci-2",  source: "subject", text: "If a process feels confusing, sketching the steps usually helps more than re-reading." },
    { id: "sci-3",  source: "subject", text: "This kind of topic often hinges on one specific bit — find that bit and the rest follows." },
  ],
  English: [
    { id: "eng-1",  source: "subject", text: "Close reading is slow on purpose — one strong line beats five rushed ones." },
    { id: "eng-2",  source: "subject", text: "If a paragraph isn't landing, it's often the claim that's vague, not the quote." },
  ],
  History: [
    { id: "hist-1", source: "subject", text: "Source questions reward going back to the source's wording itself — the answer usually hides in the phrasing." },
    { id: "hist-2", source: "subject", text: "Causes and effects look similar on the page but ask for different things — worth re-reading the question." },
  ],
};

// ── Provider implementation ──────────────────────────────────────────────────
export const ambientProvider: AmbientSignalProvider = {
  pick(ctx, recentlyShownIds) {
    const pool = (ctx.subjectHint && BY_SUBJECT[ctx.subjectHint]?.length)
      ? BY_SUBJECT[ctx.subjectHint]
      : GENERAL;

    // Filter out recently-shown to avoid immediate repetition
    const fresh = pool.filter(s => !recentlyShownIds.includes(s.id));
    const candidates = fresh.length > 0 ? fresh : pool;

    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  },
};

/**
 * Ambient signal eligibility gate.
 *
 * Per ambient-social-v1-spec.md: default to silence, earn each appearance.
 * The entire feature lives or dies on restraint and timing. Every threshold
 * is in AMBIENT_CONFIG so it can be dialled down after the visual/feel test
 * without touching components.
 *
 * The gate runs after each assistant reply completes. It does NOT decide
 * content — only WHETHER to show one, and what context to pass to the
 * content provider.
 */

import type { Message } from "../../chat/_lib/types";
import type { Note } from "./types";
import type { HorizonMode } from "./types";
import type { AmbientContext, TriggerReason } from "./ambient_signals";

export interface AmbientGateState {
  shownCount:        number;                 // signals shown this session
  shownTopics:       Set<string>;            // topics already used this session
  lastShownAtMs:     number | null;          // timestamp of last shown signal
  recentlyShownIds:  string[];               // recent signal ids to avoid repeat
}

export function emptyGateState(): AmbientGateState {
  return {
    shownCount:       0,
    shownTopics:      new Set(),
    lastShownAtMs:    null,
    recentlyShownIds: [],
  };
}

export const AMBIENT_CONFIG = {
  enabled:                 true,
  minSessionMessages:      3,                // student turns before any signal
  perSessionCapGuided:     2,
  perSessionCapFull:       1,
  cooldownMinutes:         10,
  repeatLookbackTurns:     4,                // how many recent student turns to scan
  enableDifficultySubjects: true,
  // Curated narrow set — kept short on purpose. Expand only after feel-testing.
  difficultSubjects:       ["Maths", "Science"],
} as const;

// Frustration markers — short curated list. Match as whole-word-ish substrings.
const FRUSTRATION_RE = new RegExp(
  [
    "\\bstuck\\b",
    "\\blost\\b",
    "\\bconfused\\b",
    "don'?t get",
    "don'?t understand",
    "doesn'?t make sense",
    "this is hard",
    "this is too hard",
    "\\bannoying\\b",
    "\\bfrustrat",
    "i give up",
    "still don'?t",
    "why doesn'?t",
  ].join("|"),
  "i",
);

// Tiny keyword dictionary for the lightweight subject sniff. Intentionally
// non-clever. The seam is the function — a real topic-detection layer
// replaces this later.
const SUBJECT_KEYWORDS: { subject: string; patterns: RegExp[] }[] = [
  {
    subject: "Maths",
    patterns: [
      /\balgebra|\bequation|\bsolve|\bvariable|\bsimultaneous|\bquadratic|\bderivative|\bcalculus|\bintegrat|\bfraction|\bratio|\b\d+x\b/i,
    ],
  },
  {
    subject: "Science",
    patterns: [
      /\bphotosynth|\bcell|\benzyme|\batom|\bmolecule|\belectrolysis|\bmole\b|\bnewton|\bvoltage|\bcurrent|\bforce|\bfriction|\borbit|\bgenetic/i,
    ],
  },
  {
    subject: "English",
    patterns: [
      /\bessay|\bparagraph|\bquote|\bmetaphor|\bsimile|\bclose read|\bcharacter|\btheme\b|\bnovel|\bpoem|\bShakespeare/i,
    ],
  },
  {
    subject: "History",
    patterns: [
      /\bWorld War|\brevolution|\bsource\b|\btreaty|\bempire|\bcold war|\bcausation|\bbattle of/i,
    ],
  },
];

/**
 * Infer a loose subject hint from context. v1 only.
 * - If a note-context card is attached, use its subject (already accurate).
 * - Otherwise scan the last 1–2 student messages against the keyword dict.
 * - Returns null if no clear winner — caller then either uses generic content
 *   or (per spec) skips the signal entirely.
 */
export function inferSubjectHint(messages: Message[], contextNote?: Note | null): string | null {
  if (contextNote?.subject) return contextNote.subject;

  const recentStudent = messages
    .filter(m => m.role === "user")
    .slice(-2)
    .map(m => m.content)
    .join(" ");

  if (!recentStudent.trim()) return null;

  for (const { subject, patterns } of SUBJECT_KEYWORDS) {
    if (patterns.some(p => p.test(recentStudent))) return subject;
  }

  return null;
}

export interface GateInput {
  messages:    Message[];
  contextNote: Note | null;
  mode:        HorizonMode;
  state:       AmbientGateState;
  nowMs?:      number;                       // injectable for tests
}

export interface GateResult {
  show:    boolean;
  context?: AmbientContext;
}

/**
 * The main eligibility decision. Returns { show: false } on any uncertainty.
 *
 * This MUST stay forgiving — any thrown error → no signal. We err toward
 * silence at every branch.
 */
export function shouldShowAmbientSignal(input: GateInput): GateResult {
  try {
    const { messages, contextNote, mode, state } = input;
    const now = input.nowMs ?? Date.now();

    if (!AMBIENT_CONFIG.enabled) return { show: false };

    // Hard gate: session message threshold
    const studentTurns = messages.filter(m => m.role === "user").length;
    if (studentTurns < AMBIENT_CONFIG.minSessionMessages) return { show: false };

    // Hard gate: session cap
    const cap = mode === "full"
      ? AMBIENT_CONFIG.perSessionCapFull
      : AMBIENT_CONFIG.perSessionCapGuided;
    if (state.shownCount >= cap) return { show: false };

    // Hard gate: cooldown
    if (state.lastShownAtMs !== null) {
      const elapsedMs = now - state.lastShownAtMs;
      if (elapsedMs < AMBIENT_CONFIG.cooldownMinutes * 60_000) return { show: false };
    }

    // Subject inference (may be null)
    const subjectHint = inferSubjectHint(messages, contextNote) || undefined;

    // Hard gate: per-topic uniqueness this session
    const topicKey = subjectHint || "generic";
    if (state.shownTopics.has(topicKey)) return { show: false };

    // Triggers — at least ONE must fire
    let triggerReason: TriggerReason | null = null;

    // Trigger A: frustration markers in the latest student message
    const latestStudent = [...messages].reverse().find(m => m.role === "user")?.content || "";
    if (FRUSTRATION_RE.test(latestStudent)) {
      triggerReason = "frustration";
    }

    // Trigger B: repeated concept — multiple recent clarifying messages in same area
    if (!triggerReason) {
      const recentStudent = messages
        .filter(m => m.role === "user")
        .slice(-AMBIENT_CONFIG.repeatLookbackTurns);
      const clarifyingCount = recentStudent.filter(m =>
        /\bstill\b|\bwhy doesn|\bi'?m still|so why|but how|\bagain\b/i.test(m.content),
      ).length;
      if (clarifyingCount >= 2) triggerReason = "repeated";
    }

    // Trigger C: difficult-topic match (kept narrow on purpose)
    if (!triggerReason && AMBIENT_CONFIG.enableDifficultySubjects && subjectHint
        && (AMBIENT_CONFIG.difficultSubjects as readonly string[]).includes(subjectHint)) {
      triggerReason = "difficult_topic";
    }

    if (!triggerReason) return { show: false };

    return {
      show: true,
      context: { subjectHint, triggerReason },
    };
  } catch {
    return { show: false };
  }
}

# Claude Code Build Spec — Ambient Social v1 ("You're not alone")

> **Status:** Buildable spec for the first social layer. Read `HORIZON_VISION.md` first — this implements the *ambient social* section of it. The emotional principle and the two hard rules in that doc (compare to the task never to peers; presence must be real) govern everything here.

## What you're building
The lightest social layer in Horizon: quiet, occasional signals that make a student feel **accompanied** rather than alone on hard material — without any interaction between students, and without any headcounts or presence claims. This is **not** chat, not peer features, not a feed. It is ambient *reassurance*, delivered as rare, well-timed copy.

## The core principle that makes or breaks this
Ambient social is **one sentence away from patronising wallpaper.** The craft is restraint and timing, not the messages themselves. A signal that fires on everything, or at the wrong moment, gets tuned out in a day or reads as condescending. **This feature is as much about when it stays silent as what it says.** Default to silence; earn each appearance.

## Honesty model (decided)
At launch there is **no usage density**, and the vision doc forbids faking presence. So v1 draws ONLY on **general educational truth** — statements that are honest because they're true about the *subject/task*, not claimed headcounts.
- ALLOWED: "This is one of those topics that trips a lot of people up." (true of the subject)
- FORBIDDEN: "8 students are studying this now." / "12 people found this hard." (claimed presence/headcount — not available, would be fake)
- The distinction is a hard invariant: **no number of people, no presence, no live activity.** Only honest statements about the difficulty/nature of the material itself.

## When a signal may appear (the hard part — be conservative)
Signals are **rare and contextual.** Build a small eligibility gate; if in doubt, show nothing. A signal may appear when:
- The student hits a genuinely effortful moment — e.g. asks the same concept more than once, expresses frustration/confusion, or is working on material tagged (loosely) as commonly-difficult.
- NOT on every message. NOT on easy/successful exchanges. NOT more than once per topic per session (hard cap). NOT as a greeting or filler.
- Never immediately after a previous signal — enforce a cooldown (e.g. no more than 1 ambient signal per N minutes / per session, tune conservatively).

Implementation: a single `shouldShowAmbientSignal(context)` gate with explicit, tunable thresholds, defaulting to *false*. Make the thresholds a config object so they can be dialled down trivially after the visual/feel test.

## What a signal looks like
- A quiet, inline, **non-blocking** element in the chat surface — visually subordinate to the conversation (think a soft aside, not a banner, not a popup, never modal). Dismissible/ephemeral; never demands action.
- Calm/informative styling consistent with the design system and the adaptive-mode pill — **no mascot, no character voice, no first-person AI feelings** (per vision doc anti-persona rule). It is a knowing aside, not Horizon "talking about itself."
- Tone: warm, matter-of-fact, peer-level. "This one catches a lot of people out — worth taking slowly." NOT "Don't worry!! 😊 You've got this!!" (cringe), NOT "Studies show 73% of students…" (fake-precise).
- Compares the student to the **task**, never to peers, never with any ranking or winner.

## Content source for v1
- A small, curated, local set of **general-truth message templates**, optionally keyed to loose subject/difficulty categories (e.g. a generic set + a few subject-flavoured ones for the subjects Notes already uses).
- Structure this as a replaceable content module (`ambient_signals.ts` or similar) so that later layers — real external data (examiner reports/misconceptions) and, eventually, real Horizon usage aggregates once density exists — can slot in **behind the same interface** without touching the UI. Leave that seam explicit and commented.

## Topic awareness (honest about the dependency)
For subject/difficulty-keyed signals to fire, something must loosely know what the student is working on. Horizon has no real "topic" concept yet.
- v1: do the **lightweight** version only — infer a loose subject/difficulty hint from available context (e.g. the note subject if a note-context card is attached, or simple keyword/heuristic matching). Do **not** build a real topic-detection or classification system.
- If no confident signal, fall back to fully generic general-truth messages or — preferably — show nothing.
- Leave the inference behind a single function so a real topic/class-awareness layer can replace it later.

## Decisions already made
- General educational truth only at launch; no headcounts/presence ever in v1.
- Ambient only — zero student-to-student interaction (that's peer teaching, a separate later layer).
- Lives in the Chat surface for v1 (where effortful moments happen). Not Home, not Notes, for now.
- Governed by the vision doc's emotional principle and anti-persona rules.

## Out of scope (do NOT build)
- Any headcount, presence, "live now", or activity-of-others signal.
- Any peer-to-peer interaction, feed, or visibility of other students.
- Real topic classification / class-awareness / syllabus data pipeline.
- Real usage-aggregate computation (no density exists yet; seam only).
- Surfacing in Home or Notes (Chat only for v1).

## Deliverable & how to start
A quiet, rare, honest ambient-signal element in the Chat surface, governed by a conservative, tunable eligibility gate, drawing on a replaceable general-truth content module, with explicit seams for external-data and real-usage sources later.
**Start by**: proposing (a) the eligibility-gate thresholds and cooldown model, (b) where the signal renders in the existing chat components, and (c) the content-module interface — and confirm with me **before** building. Because the whole feature lives or dies on restraint and feel, expect to tune thresholds *after* a visual/feel test, not before.

## A note on testing this one
Unlike v1's surfaces, "it compiles and returns 200" tells you almost nothing here. The only real test is **feel**: does it appear rarely enough, at the right moments, and read as a knowing aside rather than a cheerleader or a nag? Plan to sit with it, trigger it deliberately, and tune the gate down until it feels earned. Err toward *too quiet*.

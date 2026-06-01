# HORIZON_VISION.md

> **Status:** Roadmap / north-star context. **Not a build instruction.**
> v1 scope is defined separately (Home + Chat + Notes + adaptive-mode indicator). This file exists so the codebase grows coherently toward where Horizon is going. When building v1, use this to make structural choices that *anticipate* these layers — but do **not** build the layers below unless a specific build spec says so.

---

## What Horizon is (one line)
The smartest friend a student could have — brilliant at everything, remembers their whole learning journey, and genuinely wants them to win. Built on Beacon's safeguarding/governance platform, but designed first as a place students *want* to go.

## The strategic frame (why the product is shaped this way)
The competitor is not other ed-tech — it's the **ChatGPT tab already open** on the student's laptop. That tab wins on an emotional profile: private, patient, judgment-free, instant, always available, on your side. Horizon cannot win on safety (safety is a *cost* we ask students to accept). It wins on capabilities a raw chatbot **structurally cannot offer**, and uses them to make safety feel like a seatbelt in a car you love — not a spy in the room.

**Hard non-goal: Horizon is NOT an LMS.** No admin-feeling workflows, no teacher-assignment-centric UX in the student surface. If a feature starts to feel like school administration, it's wrong.

## The five roadmap layers (each = a moat a stateless chatbot can't cross)
1. **Memory & continuity** — Horizon remembers the student *as a learner* over time (topics, struggles, improvements, learning style, what's coming up). Deepest moat; sharpest privacy sensitivity (it's memory about a minor).
2. **Progress that feels good** — make improvement visible and earned, *without* points/badges/streaks cringe. Target feeling: "I understand this now and I can see that I do."
3. **Proactive companion** — Horizon initiates ("your mock's in 4 days, want to practise electrolysis?"), not just responds.
4. **Class-aware help** — tuned to real exam board / syllabus / assessment context, not generic answers.
5. **Social** — ambient + peer teaching (see below). The cleanest differentiator, because a raw chatbot is fundamentally solitary.

## The emotional principle (non-negotiable — governs all of the above)
**Horizon creates warmth toward the student's own progress — NEVER attachment to Horizon itself.**

- Make the student feel **capable** (like a great coach: "I'm better than I was"), never **attached** (companion-app model: "I want more of the bot"). The companion model is what drives current harm to minors — it is a hard line we don't cross.
- Emotional energy points **outward** (the student's growth, their peers), never inward at a relationship with the AI.
- **No AI persona/character with a name, face, or feelings.** No "I missed you." Horizon *notices* the student and reflects progress back warmly; it is not a friend-character.
- Engineering consequence of all this: **"not cringe" and "not creepy" are the same constraint.** A try-hard AI buddy reads as cringe to kids AND creepy to parents. Avoid persona; favour genuine usefulness + warmth.

## Social model (specifics, because the safety design is in the details)
**Ambient social — "you're not alone":**
- Compare the student to the **task**, never to named peers, never with a winner. ("Most people needed a few goes at this" = good. Leaderboard = poison.)
- Presence signals must be **real** — never fabricate "8 people studying now." At thin/launch usage, use honest cohort aggregates ("Year 11s tend to find this tricky"), not fake live presence.

**Peer teaching — "I helped someone" (strongest single idea):**
- Recommended model is **Horizon-mediated, NO direct contact between students.** Helper writes/records an explanation → Horizon lightly moderates → offered to a stuck student as "a classmate explained it this way." Helper gets the confidence win; learner gets a peer voice; **no DM channel between minors.**
- Dignity rules: helper is **invited, never assigned**; learner receives "a classmate's take," **never** "someone was told you're struggling."
- **Deferred, do not design yet:** live/real-time kid-to-kid interaction. That's a separate, serious safeguarding surface.

## The thesis to preserve in every decision
**The healthiest version and the most appealing version of this product are the same product.** The features that make kids return (feeling capable, accompanied, useful to a peer) are the same ones that keep it safe. If an appealing design and the safe design ever diverge, that's the signal we've drifted toward the companion-app trap — stop and rethink.

---

## What this means for v1 code *right now* (the only actionable part)
Build v1 as specified, but make these low-cost structural choices so the roadmap isn't painful later:
- **Student-as-learner data model:** structure the student object so a learning-history/memory layer can attach later (don't build memory; don't make it impossible either). Avoid hard-coding a stateless, conversation-only model.
- **Adaptive-mode is the seed of the emotional principle** — keep its styling calm/informative (coach, not character). No mascot, no persona voice.
- **Notes provenance:** already specced to capture source-conversation; keep that, it's the seam memory + progress will use.
- **No persona anywhere:** copy should be warm but tool-like, never a named character with feelings.
- **Leave a seam for ambient/social signals** in the relevant surfaces (e.g. a topic/area can later carry an aggregate "others found this hard" signal) — placeholder-friendly, not built.
- **Do NOT build:** memory, progress tracking/visualisation, proactive notifications, class/syllabus awareness, any social or peer features. These are roadmap only.

*When any layer above is ready to build, it gets its own scoping pass and its own build spec — same as v1 did.*

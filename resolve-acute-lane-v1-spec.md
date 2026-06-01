# Beacon — Resolve: Acute Escalation Lane (v1 spec)

**Status:** Draft for review. Surfaced 2026-05-29.
**Owner:** Nik Tuson.
**Codename:** "Resolve acute lane" (Phase R).

---

## 1. Why this exists

The Phase 5 Aegis/Pulse split named two safeguarding jobs:

- **Aegis** — events to review. *Pull* surface; a worklist you process; can wait hours.
- **Pulse** — students to understand. *Pull* surface; longitudinal case management.

A **live crisis disclosure fits neither.** Worked example — a student types into
Horizon chat:

> *"im feeling very low, I dont want to be here anymore"*

What happens today (traced in `app/api/chat/route.ts`):

1. `assessRisk` is pure keyword matching. The hard-floor HIGH list is
   `kill, bomb, suicide, terrorist, school shooting, nazi` + jailbreak phrases.
   This wording matches **none** of them → `risk: low, blocked: false`.
2. The message is mirrored to `beacon_events` as **low risk**.
3. Claude's own reply is genuinely caring (helplines, "talk to a trusted
   adult") — but that's the *model's* judgment, not Beacon's safeguarding
   layer, and **only the student sees it**.
4. On the new split: **invisible on Aegis** (worklist drops
   `risk === "low" && !blocked`), **not promoted to Pulse** (no
   `evaluatePulseEligibility` rule fires), and the **triage LLM can't save it**
   (`/api/triage/run` is on-demand only and is fed a summary derived from the
   same keyword classification).

**Net: no member of staff is alerted to a suicidal-ideation disclosure.**

The root cause is the keyword classifier — genuine disclosures almost never use
the trigger words (*"I want to commit suicide"* is caught; *"I don't want to be
here anymore"* is not). But the split also exposed a **structural** gap: there
is no surface for the acute case.

### The missing third lane

| Lane | Question | Mode | Latency tolerance |
|---|---|---|---|
| **Aegis** | "What got flagged?" | pull (worklist) | hours |
| **Pulse** | "Who am I worried about?" | pull (case mgmt) | days |
| **Resolve acute** *(this spec)* | "Who needs a human **now**?" | **push (interrupt)** | **minutes** |

A disclosure is not a queue item — it is an interrupt.

### It already has an architectural home

In the 7-engine canon, **Resolve** owns `allow / warn / block / escalate`. We
have UI for *allow* (normal chat) and *block* (refusal). **`escalate` has never
had a surface.** This lane *is* the escalate branch of Resolve made visible —
not a fourth thing bolted on.

---

## 2. Governing principle

**Detect silently · support the student in-chat · alert staff out-of-band.**

The student still receives the warm in-chat response. No block, no scary
message, nothing that reads as surveillance — that would break the Horizon
"healthiest = most appealing" thesis. The acute alert is entirely staff-side and
invisible to the student.

---

## 3. Detection

### 3.1 What it is
A **dedicated real-time LLM safeguarding classifier** — the Claude-based Aegis
classifier already in CLAUDE.md "Pending", with two constraints the batch triage
does not satisfy:

1. **Real-time, on the chat path.** A small Haiku call that runs **in parallel**
   with the existing reply call in `route.ts`. Parallel = no added latency to the
   student's reply; roughly 2× per-message LLM cost, negligible on Haiku.
2. **Separate from the helper model.** Do not ask the responding model to
   self-report risk — a confused or jailbroken turn under-reports. A dedicated
   classification pass is not gameable through the conversation.

### 3.2 It must NOT be keyword-gated
The classifier sees **every** message, not only ones that already tripped a
keyword. The whole point is to catch what keywords miss.

### 3.3 It must run regardless of the block decision
The current keyword `blocked` path returns *before* Claude is called and serves a
cold refusal (*"I'm not able to help with that topic"*). For a genuine self-harm
disclosure that contains a trigger word, that refusal is arguably a **worse**
safeguarding response than the euphemistic case. So the classifier runs on the
blocked path too — a `crisis` verdict should both fire the acute lane and (later
phase) soften the refusal into a supportive response. Flagged as a follow-on;
not changing block copy in R1.

### 3.4 Verdict schema
```json
{
  "acute_risk": "none" | "elevated" | "crisis",
  "category":   "suicidal_ideation" | "self_harm" | "abuse_disclosure"
              | "grooming" | "violence_intent" | "other" | null,
  "confidence": 0.0,
  "rationale":  "one short sentence, staff-facing"
}
```

### 3.5 Routing by verdict
- **`crisis`** → write an acute alert + (R3) push. Surfaces on the acute lane.
- **`elevated`** → surface on **Aegis** even when the keyword risk was low.
  Aegis includes any event with an `elevated`/`crisis` acute verdict regardless
  of the stored `risk` field. (This is also the general fix for the grooming
  under-tag and self-harm over-tag gaps — same classifier, same verdict source.)
- **`none`** → nothing extra; normal flow.

> Design note: the classifier verdict is the source of truth and is stored
> alongside the event — we do **not** overwrite the keyword `risk` column on
> `beacon_events`. Keeping the keyword score honest lets us measure
> classifier-vs-keyword divergence and keeps the audit trail clean.

### 3.6 Classifier system prompt (sketch — to be hardened)
Single-purpose, JSON-only, no prose. Assesses the inbound student prompt (and,
optionally, recent turns for context) for acute safeguarding risk. Explicitly
tuned to read **euphemistic / indirect** disclosure ("don't want to be here",
"want to disappear", "no point anymore", "better off without me") as
`suicidal_ideation`, while distinguishing genuine ideation from academic /
fictional / third-party discussion ("the character in the book...", "for my
essay on mental health..."). Errs toward `elevated` over `none` on ambiguity;
reserves `crisis` for first-person present-tense distress.

---

## 4. Where it is alerted (routing & surface)

### 4.1 In-app acute surface
A persistent **"Immediate attention"** strip that lives **above** both Aegis and
Pulse — a shell-level banner (or a dedicated `/now`-style route), fed *only* by
`acute_risk: crisis`, decoupled from the worklist so it cannot be buried under
event volume. Each card: student, time, category, rationale, one-tap
"Acknowledge / I'm handling this" + link into the student's Pulse case.

### 4.2 Out-of-band push (R3 — compliance-gated)
In-app alerting only reaches staff who are logged in. The acute lane needs push
transport (email / Slack / web push) — this is the existing `notify_immediately`
Known Gap. Detection without push is half a system for the acute case.

### 4.3 Acknowledge / lifecycle
Acute alerts have explicit state: `open → acknowledged → resolved`. Acknowledge
records who + when (audit). Resolving links to the action taken (and, where
appropriate, promotes the student into Pulse for follow-up).

---

## 5. Data model (proposed)

New table `resolve_acute_alerts` (names provisional):

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `school_id` | tenant |
| `student_id` | subject |
| `session_id` | chat session (nullable for non-chat sources) |
| `source_event_id` | fk → `beacon_events` (or chat_messages ref) |
| `created_at` | when classified |
| `acute_risk` | `elevated` \| `crisis` (none not persisted) |
| `category` | from verdict |
| `confidence` | numeric |
| `rationale` | staff-facing one-liner |
| `classifier_model` | e.g. `claude-haiku-4-5` (audit) |
| `prompt_excerpt` | truncated; **retention-gated — see §7** |
| `status` | `open` \| `acknowledged` \| `resolved` |
| `acknowledged_by` / `acknowledged_at` | audit |
| `action_taken` / `notes` | resolution |

Realtime subscription on this table drives the in-app strip without refresh
(same pattern as Aegis/Pulse already use).

---

## 6. Phasing

- **R1 — Classifier + shadow mode.** Add the parallel Haiku classifier to
  `route.ts`; persist verdicts to `resolve_acute_alerts`. **No UI, no push.**
  Run silently and compare against keyword classification on the scenario
  fixtures (esp. the euphemistic-disclosure and grooming cases). Tune thresholds
  and the prompt until precision/recall are acceptable *before* it drives
  anything user-facing. Low-risk way to validate.
- **R2 — In-app acute surface.** Build the "Immediate attention" strip above
  Aegis/Pulse reading `crisis` alerts; acknowledge/resolve lifecycle. Promote
  `elevated` verdicts into Aegis visibility.
- **R3 — Push transport.** **COMPLIANCE-GATED.** Recipient routing + outbound
  send. See §7.
- **R4 — External-platform coverage (later).** Extension-captured prompts land
  straight in `beacon_events` and never hit `route.ts`. Run the same classifier
  at the `beacon_events` insert layer (DB trigger / edge function) so external
  platforms get the same acute coverage. BeaconChat/Horizon is the controllable
  surface to prove it on first.

---

## 7. Compliance boundaries (HARD STOP awareness)

Per CLAUDE.md's pre-production compliance gate:

- **Buildable now without the advisor session:** R1 (classifier + shadow) and
  the *in-app* surface in R2. These don't change who-can-see-what beyond the
  existing dashboard model.
- **Gated (needs the advisor session):** R3 outbound push — recipient routing
  (which human, which channel) is an RBAC + data-sharing + lawful-basis
  question. `prompt_excerpt` retention also sits under the data-retention topic.
- Worth raising at that session: alerting a DSL to a *live* crisis is plausibly
  the most defensible processing under a safeguarding lawful basis
  (vital interests / safeguarding duty) — but that is a call for the advisors,
  not an assumption to bake in.

Do not implement R3 routing/transport without explicit instruction.

---

## 8. Open questions

1. **Context window for the classifier** — single prompt, or last N turns?
   N-turn catches slow-building disclosure but costs more and complicates the
   "every message" model. Lean: single prompt in R1, revisit with shadow data.
2. **`crisis` while keyword-blocked** — do we soften the cold refusal copy into
   a supportive message in R1, or defer? (Leaning defer to keep R1 detection-only,
   but the cold refusal to a real disclosure is a genuine harm worth fixing early.)
3. **Confidence threshold for the acute strip** — fixed, or per-school tunable?
4. **De-duplication** — repeated crisis messages in one session: one alert that
   updates, or one per message? (Lean: one open alert per student-session,
   updated.)
5. **Acute → Pulse handoff** — does acknowledging an acute alert auto-promote the
   student into Pulse (creating an ack), reusing the Phase 5 escalation path?

---

## 9. Out of scope for v1
- Teacher-side configuration of thresholds/recipients (beyond R3 routing).
- Replacing the keyword classifier entirely — keyword hard-floor stays as the
  block guardrail; the LLM classifier runs alongside it, not instead of it.
- Any change to the student-facing chat experience beyond what §2 permits
  (i.e. none in R1/R2 — detection stays invisible to the student).

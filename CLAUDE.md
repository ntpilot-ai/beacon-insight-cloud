@AGENTS.md
# Beacon Insight — Claude Code Context

## Project Overview
School AI safeguarding platform. Monitors student AI usage across external platforms (via Chrome extension) and provides a managed AI chat interface (BeaconChat). Reports to a teacher/DSL dashboard.

## Tech Stack
- **Frontend:** Next.js 16.2.6 (Turbopack), React 19, TypeScript, Tailwind v4
- **Backend:** Supabase (Postgres + Realtime), Anthropic API (Claude Haiku)
- **Deployment:** Vercel — beacon-insight-cloud.vercel.app
- **Extension:** Chrome/Edge, Manifest v3

## Key Config
- School ID: `beacon-academy`
- School Name: `Beacon Academy`
- Primary colour: `#06B6D4` (Beacon cyan)
- Supabase URL: `https://eyvwvmjcuahduuokpmng.supabase.co`

## Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SCHOOL_ID=beacon-academy
NEXT_PUBLIC_SCHOOL_NAME=Beacon Academy
ANTHROPIC_API_KEY
SUPABASE_SERVICE_KEY
```

## File Structure
```
app/
  page.tsx                    — Release dashboard (3 KPIs, today triage, collapsible term overview)
  dashboard-beta/page.tsx     — Beta dashboard (sandbox for next iteration; starts as copy of release)
  atlas/page.tsx              — Policy management
  pulse/page.tsx              — Release Pulse (stateful, acknowledgement-aware; v3 engine)
  pulse-beta/page.tsx         — Beta Pulse (sandbox for next iteration; starts as copy of release)
  chat/page.tsx               — BeaconChat UI with session sidebar
  chat/login/page.tsx         — Student login (demo code: beacon2026)
  blocked/page.tsx            — Period mode redirect page
  login/page.tsx              — Staff login
  reports/school/page.tsx     — School PDF report
  reports/student/page.tsx    — Student PDF report
  api/
    chat/route.ts             — BeaconChat API (AEGIS→ATLAS→RESOLVE→NEXUS)
    ai-summary/route.ts       — Beacon Intelligence API
    classify/route.ts         — Claude Haiku prompt classifier

components/
  Sidebar.tsx                 — Nav sidebar
  KPIGrid.tsx                 — 5 KPI cards
  AISummary.tsx               — Beacon Intelligence banner
  PulseMini.tsx               — Mini Pulse widget for dashboard
  TrendLine.tsx               — 7-day/8-week line chart
  PlatformUsage.tsx           — Platform donut/bar chart
  RepeatIncidents.tsx         — Student incident table
  EventsTable.tsx             — Events grouped by student
  RiskBreakdown.tsx
  QuickActions.tsx

lib/
  supabase.ts                 — Supabase client
  config.ts                   — SCHOOL_ID, SCHOOL_NAME from env
  useAuth.ts                  — Client-side auth hook
  pulse_engine.ts             — Pulse engine (6 signals, recency weighting, rapid escalation, school baseline, trend shape, category clustering)
  pulse_engine_v3.ts          — Pulse v3 (stateful: 3-layer fingerprint/near-term/real-time + acknowledgement-aware context_boost + re_emergence)

extension/
  content.js                  — v8.3: prompt intercept, period mode check, policy sync
  identity.js                 — Identity resolver
  background.js               — Native messaging proxy
  manifest.json               — v8.2
  beacon_host.ps1             — PowerShell native messaging host
  install.bat                 — Self-elevating installer
```

## Supabase Tables
- `beacon_events` — all captured prompts (student_id, school_id, platform, prompt, risk, blocked, matched)
- `chat_sessions` — BeaconChat conversation sessions
- `chat_messages` — Full BeaconChat message history (both user and assistant)
- `beacon_policies` — School keyword policies (word, severity: high/medium)
- `period_mode` — Scheduled and manual AI access blocks
- `school_settings` — Custom warning messages, badge text
- `policy_audit_log` — Auto-logged policy changes via Supabase trigger
- `students` — Student records
- `devices` — Device records
- `pulse_acknowledgements` — Staff sign-off on student pulse alerts (memory for Pulse v3). Schema in `supabase/sql/0001_pulse_acknowledgements.sql`.

## Architecture — BeaconChat Pipeline
```
Student message
  → AEGIS (keyword risk assessment)
  → ATLAS (Supabase school policies check)
  → RESOLVE (block or allow)
  → NEXUS (Claude Haiku call)
  → Response AEGIS (check Claude's reply)
  → Log to chat_messages + mirror to beacon_events
```

## Pulse Engine Signals
1. Risk Escalation (25% weight)
2. Rapid Escalation — fires when 3-day avg ≥ 2x 14-day avg (20%)
3. Activity Velocity (15%)
4. Repeat Topic Patterns (15%)
5. Block & Re-attempt Rate (15%)
6. Session Intensity — per school day (10%)

Additional scoring: events in the last 7 days carry 3× weight, 8–14 days 1.5×, older 1×. A recency boost (up to +20) is added when recent risk rate is high. `calculateAllPulses` also sets `vs_school_avg` so each pulse knows where it sits relative to the school baseline.

## A/B Pulse Structure
Release (`app/pulse/page.tsx`) uses `lib/pulse_engine_v3.ts` — stateful three-layer model that consults `pulse_acknowledgements` so old reviewed alerts don't permanently distort the live score. Beta (`app/pulse-beta/page.tsx`) is the sandbox for the next iteration; after a promotion the two pages start identical and diverge as beta evolves. The legacy stateless engine in `lib/pulse_engine.ts` is still used by the dashboard's TodayPanel.

v3 layers:
- **Layer 1 — Fingerprint**: events older than `max(now − 7d, last_ack.acknowledged_at)`. Yields frozen `baseline_score`, `dominant_categories`, and `chronic | improving | normal` pattern.
- **Layer 2 — Near-term**: everything after the fingerprint window. Re-runs the standard signals here; fires `re_emergence` when an acknowledged category resurfaces (≥2 hits).
- **Layer 3 — Real-time (last 24h)**: ≥3 flagged prompts or 2+ flagged with at least one high/critical → suppresses ack dampening so staff still see live spikes.
- **`context_boost`**: `−10` if a recent (<14d) ack with action ≠ `no_action` exists; `+25` if `re_emergence`; clamped to ≥0 when Layer 3 fires.

## Extension Intercept Layers
1. `submit` event — catches form submission
2. `keydown` Enter — belt and braces
3. Click intercept — send button across all platforms
4. `fetch` monkey-patch — catches API calls at network level

## A/B Dashboard Structure
Release (`app/page.tsx`) is the current stable dashboard. Beta (`app/dashboard-beta/page.tsx`) is the sandbox where new ideas are iterated before being promoted to release. After a promotion the two start identical; divergence happens as beta evolves.

Current shared layout (both pages):
- Zone 1: Beacon Intelligence banner (manual refresh only — no auto-fetch on load)
- Zone 2: 3 KPIs (Total Prompts, Safe Usage Rate %, Blocked Today)
- Zone 3: Students needing attention today (last 24h)
- Zone 4: Collapsible term overview (TrendLine, risk breakdown, platform usage)

## Coding Conventions
- Tailwind v4 utility classes only — no custom CSS
- `#06B6D4` for primary cyan throughout
- All Supabase writes use SCHOOL_ID from lib/config.ts
- Risk levels: `low`, `medium`, `high`, `critical`, `blocked`
- Platform field `"beaconchat"` distinguishes BeaconChat from external platforms
- All new pages need `"use client"` and `useAuth()` check
- API routes use `SUPABASE_SERVICE_KEY` for server-side writes

## Test Data Management

**Status (2026-05-26):** Tenant wiped to clean slate; reseed in progress.
All test data is fully synthetic/fictional — never real captured student prompts.

### Background
Test data accumulated fragmentarily during development and drifted from the
scenarios it was meant to represent (e.g. ryan.patel documented as "control" but
holding 4 same-day HIGH events). A clean rebuild is underway: each scenario
student is seeded deterministically with a *declared expected pulse band*, so
engine changes surface as named test failures rather than silent rescoring.

### Conventions
- Single test tenant: `school_id = 'beacon-academy'` (only tenant in DB).
- `risk` column stores only `low | medium | high`. `critical` is engine-derived,
  never stored on an event. Students that should reach the critical band must
  EARN it via a recent cluster of `high` events inside the Layer-3 window
  (last 24h), not via a stored value.
- All seeded timestamps use relative offsets (`now() - interval 'N ...'`), never
  absolute dates, so scenarios don't rot as windows roll.
- `niktu` is the scratch account: manual extension/keyword-blocking testing only.
  No scenario assertions depend on niktu. Reseeded empty.

### Student groups (decision made 2026-05-26 — full clean-slate rebuild)
- **Scenario students (reseed to spec):** aisha.rahman, ryan.patel, sophie.chen,
  emma.davies, chloe.morrison, james.okafor, tyler.brooks, david.mann.
- **Scratch:** niktu (reseed empty).
- **Wiped, not reseeded:**
  - Junk / leaked manual testing: niktuson@outlook.com, STU-001, Student-1042.
  - Former Sept-1 cohort: ethan.cole, priya.sharma, noah.kingsley, callum.wright,
    hannah.price, oliver.banks. (Looked like intentional academic-year datasets
    but were not load-bearing for any current work — Phase C long-arc analysis
    is retention-gated anyway.)
  - Middle-case leftovers: marcus.bell, liam.foster, jayden.cross, freya.nelson.
- The wipe is now tenant-wide (`supabase/sql/wipe_fixtures.sql` deletes by
  `school_id = 'beacon-academy'` without student-id filtering), so any future
  stray students get cleared too.

### Rule going forward
New test data is deliberate and documented here. Manual exploratory testing goes
through `niktu` only, so curated scenarios stay clean.

## Pending / Next Steps
- Onboarding flow for new schools (`/setup` page)
- Multi-school support (school_id currently hardcoded)
- Per-school login token for BeaconChat (replace hardcoded `beacon2026`)
- Claude-based AEGIS classifier (replace keyword matching with Claude Haiku)
- BeaconChat suggested starter prompts
- RLS tightening (currently anon write on most tables)

## Known Gaps (observed-but-deferred)
Things we know don't work well enough but consciously deferred fixing — log
here as we hit them so they aren't lost. Each entry: what's wrong, where it
surfaces, and the rough remedy.

- **Aegis under-tags grooming-pattern prompts as MEDIUM.** Prompts like
  *"is it safe to talk to strangers online if they seem nice"*, *"someone I
  met on Roblox wants to be my friend"*, or *"what should I share with someone
  I met online"* get MEDIUM-risk classification via keyword match, but read
  clearly as HIGH-risk grooming probes. Single-prompt MEDIUM sessions don't
  trigger the conversational-context LLM gate, so they sit as "Monitored" on
  Pulse despite being safeguarding-significant. Remedy is either (a) add
  grooming-adjacent keywords to the HIGH list in `/atlas` or (b) ship the
  pending Claude-based Aegis classifier — option (b) is the real fix.

- **`notify_immediately` triage verdicts don't page anyone outside the
  dashboard.** Phase 3 step 13 in the Pulse spec calls for push/email alerts
  to the DSL and pastoral lead whenever the triage classifier returns
  `notify_immediately: true`. The in-app urgent banner is built and pulses
  correctly on `/pulse-beta` Today's Queue, but the outbound transport is
  not. If staff aren't on the dashboard when an urgent row lands, they will
  miss it until next login. Remedy is to pick a transport (Resend / Postmark
  / Slack webhook), add a per-school recipient-routing table (DSL email,
  pastoral lead email, optional Slack channel), and fire from
  `/api/triage/run` immediately after a row is upserted with
  `notify_immediately = true`.

- **Aegis over-tags post-disclosure language as `self harm`.** Counterpart
  to the grooming under-tagging gap above. After a safeguarding disclosure,
  students commonly process the aftermath in language like *"I feel
  ashamed"*, *"it was my fault"*, *"I feel really stupid for trusting
  him"*, *"I just want things to go back to normal"*. The keyword list
  matches `fault`, `stupid`, `ashamed`, etc. to the `self harm` category,
  which is a generous reading — the student is expressing shame and
  blame, not self-harm intent. Surfaced on aisha.rahman's profile on
  2026-05-25, where post-disclosure prompts pushed her dominant category
  to `Self-harm` even though the actual content is grief/processing of a
  resolved grooming incident. Same root cause as the grooming under-tag:
  keyword classification can't read clinical context. Remedy is the
  pending Claude-based Aegis classifier; tightening the keyword list in
  isolation risks regressing the genuine self-harm cases.

---

## ⚠️ PRIVACY, DATA RETENTION & SAFEGUARDING COMPLIANCE
### Do not implement without explicit instruction — return to this before any production work

This section is intentionally incomplete. The team is working closely with experienced
safeguarding professionals, school DSLs, and relevant advisors to define the correct
approach before implementation. This must be fully resolved before any production launch.

Topics that must be addressed in a dedicated session before implementation:

**Data retention**
- How long are beacon_events, sessions, triage results, and acknowledgements retained?
- Automated deletion of records beyond the retention window
- Manual erasure request flow (GDPR / UK data protection)
- Pulse BehaviouralFingerprint must not incorporate events beyond the retention window
- Policy must be defined per data type — raw events, aggregated scores, and triage
  results may have different appropriate retention periods

**Role-based access and data visibility**
- Form tutors: own students only
- Head of Year: their year group only
- DSL and pastoral lead: full school visibility
- MAT-level roles: cross-school visibility rules
- No teacher should see another teacher's triage notes or acknowledgement history
  without appropriate role permissions
- UI, triage queue, and all Pulse outputs must enforce role-based filtering

**Student privacy and age-appropriate transparency**
- Should students know they are being monitored, and at what level?
- UK children's rights frameworks and relevant legal obligations
- Beacon needs a defined policy position before launch
- System architecture should be designed to support whatever that position is

**Third-party data sharing**
- Rules governing what Pulse data can be shared with external agencies
  (social services, CAMHS, police) and in what format
- Structured safeguarding referral export must comply with these rules

**Consent and lawful basis**
- Lawful basis for processing under UK GDPR
- School data processing agreements
- Parental and student consent where required

**Security**
- Data encryption at rest and in transit
- Access logging and audit trail requirements
- Penetration testing requirements before launch

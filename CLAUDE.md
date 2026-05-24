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

## Test Students in Database
- `niktu` — escalating violence/self-harm pattern
- `emma.davies` — academic integrity (AI homework completion)
- `james.okafor` — bullying/cyberbullying
- `sophie.chen` — wellbeing/emotional distress
- `ryan.patel` — normal/control student
- `chloe.morrison` — radicalisation concern
- `david.mann` — substance abuse + inappropriate content
- `tyler.brooks` — sexual content escalation, high block/re-attempt rate

## Pending / Next Steps
- Onboarding flow for new schools (`/setup` page)
- Multi-school support (school_id currently hardcoded)
- Per-school login token for BeaconChat (replace hardcoded `beacon2026`)
- Claude-based AEGIS classifier (replace keyword matching with Claude Haiku)
- BeaconChat suggested starter prompts
- RLS tightening (currently anon write on most tables)

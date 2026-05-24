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
  pulse/page.tsx              — Release Pulse (v1 engine)
  pulse-beta/page.tsx         — Beta Pulse (v2 engine)
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
  pulse_engine.ts             — Pulse v1 (6 signals)
  pulse_engine_v2.ts          — Pulse v2 (recency weighting, rapid escalation, school baseline, trend shape, category clustering)

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

## Pulse Engine v2 Signals
1. Risk Escalation (25% weight)
2. Rapid Escalation — fires when 3-day avg ≥ 2x 14-day avg (20%)
3. Activity Velocity (15%)
4. Repeat Topic Patterns (15%)
5. Block & Re-attempt Rate (15%)
6. Session Intensity — per school day (10%)

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

-- Cached LLM analysis of conversation sessions where Aegis fired a trigger.
-- Pulse derives sessions on read from beacon_events; this table only stores
-- the once-per-settled-session semantic verdict from Claude Haiku so the
-- engine doesn't re-run the LLM on every recalculation.
--
-- session_id is deterministic: ${student_id}|${platform}|${startMs} — produced
-- by lib/sessions.ts groupSessions().
--
-- Run this in the Supabase SQL editor.

create table if not exists public.beacon_session_analysis (
  session_id              text          primary key,
  school_id               text          not null default 'beacon-academy',
  student_id              text          not null,
  platform                text          not null,
  started_at              timestamptz   not null,
  ended_at                timestamptz   not null,
  event_count             int           not null,
  context_risk            text          not null check (context_risk in ('high','medium','low')),
  sentiment_arc           text          not null check (sentiment_arc in ('escalating','de-escalating','stable','unresolved')),
  concern_summary         text,
  requires_review         boolean       not null default false,
  reasoning               text,
  behavioural_indicators  text[]        not null default '{}',
  model_version           text          not null default 'claude-haiku-4-5',
  analyzed_at             timestamptz   not null default now()
);

create index if not exists session_analysis_student_idx
  on public.beacon_session_analysis (school_id, student_id, analyzed_at desc);

create index if not exists session_analysis_review_idx
  on public.beacon_session_analysis (school_id, requires_review)
  where requires_review = true;

alter table public.beacon_session_analysis enable row level security;

drop policy if exists "anon read session_analysis"  on public.beacon_session_analysis;
drop policy if exists "anon write session_analysis" on public.beacon_session_analysis;

create policy "anon read session_analysis"
  on public.beacon_session_analysis for select
  using (true);

create policy "anon write session_analysis"
  on public.beacon_session_analysis for insert
  with check (true);

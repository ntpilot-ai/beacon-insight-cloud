-- Daily Pulse triage results: per-student, once-per-day LLM verdict on
-- whether the student requires staff attention today.
--
-- Sits one layer above the v3 engine. The engine produces a structured
-- behavioural summary; this row stores the classifier's interpretation of
-- that summary in plain English plus a triage level for the daily queue.
--
-- Uniqueness is one row per (school, student, day-of-assessment) — re-running
-- triage on the same day for the same student is an upsert, not a duplicate.
--
-- Run this in the Supabase SQL editor after 0004_manual_llm_gate.sql.

create table if not exists public.beacon_triage_results (
  id                  uuid         primary key default gen_random_uuid(),
  school_id           text         not null default 'beacon-academy',
  student_id          text         not null,
  assessed_at         timestamptz  not null default now(),
  triage              text         not null check (triage in
    ('silent_monitoring','low','medium','high','urgent')),
  concern_summary     text,
  suggested_action    text,
  notify_immediately  boolean      not null default false,
  reasoning           text,
  input_snapshot      text,
  model_version       text         not null default 'claude-haiku-4-5',
  requested_by        text
);

-- One triage row per student per UTC day. Day is derived from assessed_at so
-- re-runs upsert rather than stacking. UTC is fine for an MVP — schools are
-- single-timezone for now; multi-region can re-bucket later.
create unique index if not exists beacon_triage_results_daily_uniq
  on public.beacon_triage_results
     (school_id, student_id, ((assessed_at at time zone 'UTC')::date));

create index if not exists beacon_triage_results_recent_idx
  on public.beacon_triage_results (school_id, assessed_at desc);

create index if not exists beacon_triage_results_urgent_idx
  on public.beacon_triage_results (school_id, assessed_at desc)
  where notify_immediately = true;

alter table public.beacon_triage_results enable row level security;

drop policy if exists "anon read triage_results"   on public.beacon_triage_results;
drop policy if exists "anon write triage_results"  on public.beacon_triage_results;
drop policy if exists "anon update triage_results" on public.beacon_triage_results;

create policy "anon read triage_results"
  on public.beacon_triage_results for select
  using (true);

create policy "anon write triage_results"
  on public.beacon_triage_results for insert
  with check (true);

-- UPDATE allowed so /api/triage/run can upsert today's row when re-run
-- (e.g. teacher hits "Re-run today's triage" after acknowledging students).
create policy "anon update triage_results"
  on public.beacon_triage_results for update
  using (true)
  with check (true);

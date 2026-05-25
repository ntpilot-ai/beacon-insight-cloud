-- Pulse snooze: staff can defer a student from the triage queue for a fixed
-- window or "until something changes". The classifier checks for an active
-- snooze before spending an LLM call, and the queue UI hides snoozed rows
-- in a collapsed section.
--
-- One row per snooze decision. A snooze is "active" while:
--     broken_early = false
--   AND (expires_at IS NULL OR expires_at > now())
--
-- When an override condition fires (re-emergence, rapid escalation, etc.)
-- the classifier flips broken_early = true + records broken_reason on the
-- snooze row and proceeds to run the LLM normally. The history of broken
-- snoozes stays in the table for audit.
--
-- Run this in the Supabase SQL editor after 0005_beacon_triage_results.sql.

create table if not exists public.pulse_snooze (
  id              uuid          primary key default gen_random_uuid(),
  school_id       text          not null default 'beacon-academy',
  student_id      text          not null,
  snoozed_by      text          not null,
  snoozed_at      timestamptz   not null default now(),
  expires_at      timestamptz,                       -- null = until something changes
  duration_label  text          not null,            -- e.g. "24h", "7d", "until-change"
  reason          text,
  broken_early    boolean       not null default false,
  broken_at       timestamptz,
  broken_reason   text
);

-- Active-snooze lookup is the hot path: per school, get the most recent
-- non-broken row per student where expires_at is null or in the future.
create index if not exists pulse_snooze_active_idx
  on public.pulse_snooze (school_id, student_id, snoozed_at desc)
  where broken_early = false;

create index if not exists pulse_snooze_school_recent_idx
  on public.pulse_snooze (school_id, snoozed_at desc);

alter table public.pulse_snooze enable row level security;

drop policy if exists "anon read pulse_snooze"   on public.pulse_snooze;
drop policy if exists "anon write pulse_snooze"  on public.pulse_snooze;
drop policy if exists "anon update pulse_snooze" on public.pulse_snooze;

create policy "anon read pulse_snooze"
  on public.pulse_snooze for select
  using (true);

create policy "anon write pulse_snooze"
  on public.pulse_snooze for insert
  with check (true);

-- UPDATE needed so the classifier can mark a snooze broken_early when an
-- override condition fires. Matches the anon-write pattern used elsewhere
-- (see RLS-tightening TODO in CLAUDE.md).
create policy "anon update pulse_snooze"
  on public.pulse_snooze for update
  using (true)
  with check (true);

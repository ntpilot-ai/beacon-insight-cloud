-- Pulse acknowledgements: staff sign-off on a student's current pulse alert.
-- Acts as the memory layer for pulse_engine_v3 — once acknowledged, that pattern
-- becomes part of the student's behavioural fingerprint and only re-fires if it
-- re-emerges in fresh activity.
--
-- Run this in the Supabase SQL editor.

create table if not exists public.pulse_acknowledgements (
  id                uuid          primary key default gen_random_uuid(),
  school_id         text          not null default 'beacon-academy',
  student_id        text          not null,
  acknowledged_by   text          not null,
  acknowledged_at   timestamptz   not null default now(),
  alert_level       text          not null check (alert_level in ('critical','high','medium','low')),
  dominant_category text,
  action_taken      text          not null check (action_taken in ('monitored','referred','escalated','no_action')),
  notes             text,
  expires_at        timestamptz,
  created_at        timestamptz   not null default now()
);

create index if not exists pulse_acks_student_recent_idx
  on public.pulse_acknowledgements (school_id, student_id, acknowledged_at desc);

create index if not exists pulse_acks_school_recent_idx
  on public.pulse_acknowledgements (school_id, acknowledged_at desc);

-- RLS matches the rest of the project (anon read/write — see RLS-tightening TODO
-- in CLAUDE.md). Tighten when multi-school auth lands.
alter table public.pulse_acknowledgements enable row level security;

drop policy if exists "anon read pulse_acks"  on public.pulse_acknowledgements;
drop policy if exists "anon write pulse_acks" on public.pulse_acknowledgements;

create policy "anon read pulse_acks"
  on public.pulse_acknowledgements for select
  using (true);

create policy "anon write pulse_acks"
  on public.pulse_acknowledgements for insert
  with check (true);

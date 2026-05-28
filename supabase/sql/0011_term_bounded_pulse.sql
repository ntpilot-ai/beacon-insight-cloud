-- Term-bounded pulse — Phase 1 (data model).
-- See memory: project-term-bounded-pulse for the full design.
--
-- Two tables:
--   school_terms          — per-school academic calendar (3 rows/year typical).
--   pulse_term_snapshots  — frozen per-student pulse summary at end of each term.
--
-- Snapshots are designed to survive raw-event pruning: key_incidents is
-- embedded JSON so a snapshot stays meaningful even after retention deletes
-- the underlying beacon_events.
--
-- Run this in the Supabase SQL editor after 0010_triage_reviewed.sql.

------------------------------------------------------------------------------
-- 1. school_terms
------------------------------------------------------------------------------

create table if not exists public.school_terms (
  id              uuid         primary key default gen_random_uuid(),
  school_id       text         not null default 'beacon-academy',
  term_id         text         not null,   -- e.g. '2025-26-autumn'
  academic_year   text         not null,   -- e.g. '2025-26' (for year-view grouping)
  name            text         not null,   -- human label, e.g. 'Autumn Term 2025'
  start_date      date         not null,
  end_date        date         not null,
  created_at      timestamptz  not null default now(),

  constraint school_terms_dates_check check (end_date > start_date)
);

-- One term_id per school (lookup key for snapshots).
create unique index if not exists school_terms_school_term_uniq
  on public.school_terms (school_id, term_id);

-- Common access: "what term is today in for school X?"
create index if not exists school_terms_school_window_idx
  on public.school_terms (school_id, start_date, end_date);

alter table public.school_terms enable row level security;

drop policy if exists "anon read school_terms"  on public.school_terms;
drop policy if exists "anon write school_terms" on public.school_terms;

create policy "anon read school_terms"
  on public.school_terms for select using (true);

create policy "anon write school_terms"
  on public.school_terms for insert with check (true);

------------------------------------------------------------------------------
-- 2. pulse_term_snapshots
------------------------------------------------------------------------------

create table if not exists public.pulse_term_snapshots (
  id                    uuid         primary key default gen_random_uuid(),

  -- Identity
  school_id             text         not null default 'beacon-academy',
  student_id            text         not null,
  term_id               text         not null,
  term_start            date         not null,   -- denormalized; survives term row edits
  term_end              date         not null,
  locked_at             timestamptz  not null default now(),

  -- Headline
  final_score           numeric      not null,
  final_alert_level     text         not null,
  opening_alert_level   text         not null,
  trajectory            text         not null,   -- engine-defined; Phase 2 locks vocabulary

  -- Categorical
  dominant_categories   text[]       not null default '{}',
  pattern               text         not null,   -- chronic | improving | normal

  -- Engagement
  ack_count             int          not null default 0,
  referral_count        int          not null default 0,
  layer3_event_days     int          not null default 0,

  -- Context (embedded so snapshot survives raw-event pruning)
  key_incidents         jsonb        not null default '[]'::jsonb,   -- top 3, [{timestamp, summary, category, risk_level}]
  total_events          int          not null default 0,
  flagged_events        int          not null default 0,

  created_at            timestamptz  not null default now(),

  constraint pts_final_level_check
    check (final_alert_level in ('critical','high','medium','low','normal')),
  constraint pts_opening_level_check
    check (opening_alert_level in ('critical','high','medium','low','normal')),
  constraint pts_pattern_check
    check (pattern in ('chronic','improving','normal'))
);

-- One snapshot per student per term (snapshot generation is upsert-safe).
create unique index if not exists pulse_term_snapshots_student_term_uniq
  on public.pulse_term_snapshots (school_id, student_id, term_id);

-- "Previous term for student X" lookup (detail panel header row).
create index if not exists pulse_term_snapshots_student_recent_idx
  on public.pulse_term_snapshots (school_id, student_id, term_end desc);

-- "Carry-over watch list" — students who ended a term high/critical.
create index if not exists pulse_term_snapshots_carryover_idx
  on public.pulse_term_snapshots (school_id, term_end desc)
  where final_alert_level in ('high','critical');

alter table public.pulse_term_snapshots enable row level security;

drop policy if exists "anon read pulse_term_snapshots"   on public.pulse_term_snapshots;
drop policy if exists "anon write pulse_term_snapshots"  on public.pulse_term_snapshots;
drop policy if exists "anon update pulse_term_snapshots" on public.pulse_term_snapshots;

create policy "anon read pulse_term_snapshots"
  on public.pulse_term_snapshots for select using (true);

create policy "anon write pulse_term_snapshots"
  on public.pulse_term_snapshots for insert with check (true);

-- UPDATE allowed so manual-lock overrides (decision 6) can amend a snapshot
-- before final archive; also allows backfill/repair.
create policy "anon update pulse_term_snapshots"
  on public.pulse_term_snapshots for update using (true) with check (true);

------------------------------------------------------------------------------
-- 3. Seed beacon-academy 2025-26
------------------------------------------------------------------------------
-- Typical English-state-school term shape; schools edit at setup.
-- Today (2026-05-26) sits inside the Summer term.

insert into public.school_terms (school_id, term_id, academic_year, name, start_date, end_date) values
  ('beacon-academy', '2025-26-autumn', '2025-26', 'Autumn Term 2025', '2025-09-01', '2025-12-19'),
  ('beacon-academy', '2025-26-spring', '2025-26', 'Spring Term 2026', '2026-01-05', '2026-03-27'),
  ('beacon-academy', '2025-26-summer', '2025-26', 'Summer Term 2026', '2026-04-13', '2026-07-17')
on conflict (school_id, term_id) do nothing;

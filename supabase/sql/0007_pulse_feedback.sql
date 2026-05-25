-- pulse_feedback: staff "not a concern" submissions that teach Pulse what
-- matters at this school.
--
-- reason values:
--   known_student      — activity is expected for this student
--   sentiment_misread  — context was not distressing
--   keyword_irrelevant — keyword match was not relevant in context
--   other              — free text in notes field
--
-- signal_context captures the contributing signal IDs at submission time for
-- audit purposes. category is the dominant category on the student's pulse at
-- the time of submission.
--
-- Run after 0006_pulse_snooze.sql.

create table if not exists public.pulse_feedback (
  id              uuid         primary key default gen_random_uuid(),
  school_id       text         not null default 'beacon-academy',
  student_id      text         not null,
  triage_id       text         not null,
  submitted_by    text         not null,
  submitted_at    timestamptz  not null default now(),
  reason          text         not null check (reason in ('known_student', 'sentiment_misread', 'keyword_irrelevant', 'other')),
  notes           text,
  signal_context  text[]       not null default '{}',
  sentiment_trend text,
  category        text
);

create index if not exists pulse_feedback_student_idx
  on public.pulse_feedback (school_id, student_id, submitted_at desc);

create index if not exists pulse_feedback_calibration_idx
  on public.pulse_feedback (school_id, category, reason);

alter table public.pulse_feedback enable row level security;

drop policy if exists "anon read pulse_feedback"  on public.pulse_feedback;
drop policy if exists "anon write pulse_feedback" on public.pulse_feedback;

create policy "anon read pulse_feedback"
  on public.pulse_feedback for select using (true);

create policy "anon write pulse_feedback"
  on public.pulse_feedback for insert with check (true);

-- student_signal_suppression: immediate per-student modifier applied to the
-- next 7 days of triage scoring after a "not a concern" submission.
--
-- factor: 0.0–1.0 multiplier on the signal's score (0.3 = 70% reduction).
-- signal_id null = suppress all signals for this student.
-- category  null = applies regardless of dominant category.
--
-- expires_at is always 7 days from submission and never extended — the student
-- continues to be monitored; only the specific misfiring signal carries less
-- weight temporarily.

create table if not exists public.student_signal_suppression (
  id          uuid         primary key default gen_random_uuid(),
  school_id   text         not null default 'beacon-academy',
  student_id  text         not null,
  signal_id   text,
  category    text,
  factor      float        not null default 0.3 check (factor >= 0 and factor <= 1),
  expires_at  timestamptz  not null,
  reason      text,
  feedback_id uuid         references public.pulse_feedback (id)
);

create index if not exists student_signal_suppression_active_idx
  on public.student_signal_suppression (school_id, student_id, expires_at desc);

alter table public.student_signal_suppression enable row level security;

drop policy if exists "anon read student_signal_suppression"  on public.student_signal_suppression;
drop policy if exists "anon write student_signal_suppression" on public.student_signal_suppression;

create policy "anon read student_signal_suppression"
  on public.student_signal_suppression for select using (true);

create policy "anon write student_signal_suppression"
  on public.student_signal_suppression for insert with check (true);

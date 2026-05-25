-- Mark triage rows as reviewed so they stay out of the queue after refresh.
-- Previously "Mark reviewed" only inserted a pulse_acknowledgement and filtered
-- the row out of local state — on page refresh the triage row reappeared.
-- Run after 0009_student_clusters.sql.

alter table public.beacon_triage_results
  add column if not exists reviewed_at  timestamptz,
  add column if not exists reviewed_by  text;

create index if not exists beacon_triage_reviewed
  on public.beacon_triage_results (school_id, reviewed_at)
  where reviewed_at is null;

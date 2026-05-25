-- Add snooze-time baseline columns to pulse_snooze so the classifier can
-- compare current pulse state to the state *when the snooze was created*.
-- Without this, shouldBreakSnooze fires for "critical" on every triage run
-- when a student was already at critical when snoozed.
--
-- snooze_time_score:       pulse_score at creation (null = legacy row, no baseline)
-- snooze_time_alert_level: alert_level at creation ("critical","high","medium","low")
--
-- Run after 0007_pulse_feedback.sql.

alter table public.pulse_snooze
  add column if not exists snooze_time_score       integer,
  add column if not exists snooze_time_alert_level text;

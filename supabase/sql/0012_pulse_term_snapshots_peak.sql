-- Term-bounded pulse — add peak_alert_level (Phase 4.5 design fix).
--
-- final_alert_level captures the engine state at term-end. That collapses
-- a student who peaked in mid-term but calmed by end-of-term to the same
-- band as a student who was steady-low all term. For carry-over filtering
-- and cross-term re_emergence we need the highest level reached during the
-- term, not just the closing level.
--
-- peak_alert_level: computed in lib/snapshot.ts by scanning weekly windows
-- across the term and taking the max band. NOT NULL with default 'low' so
-- existing rows (generated before this fix) remain valid until regenerated.
--
-- Run this in the Supabase SQL editor after 0011_term_bounded_pulse.sql.

alter table public.pulse_term_snapshots
  add column if not exists peak_alert_level text not null default 'low';

alter table public.pulse_term_snapshots
  drop constraint if exists pts_peak_level_check;
alter table public.pulse_term_snapshots
  add  constraint pts_peak_level_check
       check (peak_alert_level in ('critical','high','medium','low','normal'));

-- Carry-over watch-list index that gates on peak, not final. The existing
-- pulse_term_snapshots_carryover_idx on final_alert_level stays in place
-- (still useful for the "ended at high/critical" lookup) but UI queries for
-- "concerning previous term" will use this one.
create index if not exists pulse_term_snapshots_peak_carryover_idx
  on public.pulse_term_snapshots (school_id, term_end desc)
  where peak_alert_level in ('high','critical');

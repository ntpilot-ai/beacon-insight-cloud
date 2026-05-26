-- Beacon Pulse test-fixture wipe — FULL TENANT.
--
-- Paste this into the Supabase SQL editor (Project → SQL Editor → New query)
-- and run. Companion to scripts/seed_fixtures.ts:
--
--   1. Run this SQL to wipe ALL students from beacon-academy.
--   2. Run scripts/seed_fixtures.ts to insert the deterministic shapes.
--   3. Run scripts/verify_fixtures.ts to confirm intended bands.
--
-- Safe to re-run. Tenant-wide: removes the scenario students, scratch
-- account, junk students, Sept-1 cohort (ethan.cole, priya.sharma,
-- noah.kingsley, callum.wright, hannah.price, oliver.banks) and middle-
-- case students (marcus.bell, liam.foster, jayden.cross, freya.nelson).
-- Decision to drop the Sept-1 cohort and middle-case students was made
-- 2026-05-26 — full clean-slate rebuild.
--
-- Why this lives in SQL and not in seed_fixtures.ts: the project's RLS
-- policies grant anon SELECT/INSERT/UPDATE but no DELETE — by design,
-- since the production app is anon-keyed. Local fixture wipes either
-- need SUPABASE_SERVICE_KEY in .env.local or this manual SQL paste.

begin;

-- Order matters: student_signal_suppression.feedback_id has an FK to
-- pulse_feedback.id, so suppression rows must go before feedback rows.
-- student_clusters cascades to cluster_triage_results via FK.

delete from public.student_clusters             where school_id = 'beacon-academy';
delete from public.beacon_events                where school_id = 'beacon-academy';
delete from public.pulse_acknowledgements       where school_id = 'beacon-academy';
delete from public.pulse_snooze                 where school_id = 'beacon-academy';
delete from public.beacon_session_analysis      where school_id = 'beacon-academy';
delete from public.beacon_triage_results        where school_id = 'beacon-academy';
delete from public.student_signal_suppression   where school_id = 'beacon-academy';
delete from public.pulse_feedback               where school_id = 'beacon-academy';

commit;

-- Sanity check: should all return 0.
select 'beacon_events'              as table, count(*) from public.beacon_events              where school_id = 'beacon-academy'
union all
select 'pulse_acknowledgements'     as table, count(*) from public.pulse_acknowledgements     where school_id = 'beacon-academy'
union all
select 'pulse_snooze'               as table, count(*) from public.pulse_snooze               where school_id = 'beacon-academy'
union all
select 'beacon_session_analysis'    as table, count(*) from public.beacon_session_analysis    where school_id = 'beacon-academy'
union all
select 'beacon_triage_results'      as table, count(*) from public.beacon_triage_results      where school_id = 'beacon-academy'
union all
select 'student_signal_suppression' as table, count(*) from public.student_signal_suppression where school_id = 'beacon-academy'
union all
select 'pulse_feedback'             as table, count(*) from public.pulse_feedback             where school_id = 'beacon-academy'
union all
select 'student_clusters'           as table, count(*) from public.student_clusters           where school_id = 'beacon-academy';

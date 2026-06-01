-- One-off cleanup: remove school-level policy rows that duplicate a Beacon
-- default, now that beacon_default_policies is the canonical source.
--
-- Before Phase 1, every school's `beacon_policies` table held the full
-- 115-row keyword list. After 0015_seed_beacon_defaults.sql, those same
-- words now live in `beacon_default_policies` and are merged in by the
-- chat API and extension. The school-level rows became duplicates: they
-- still show up in the Atlas "Your school's additions" columns even
-- though the school never explicitly added them.
--
-- This migration deletes only the rows that EXACTLY match a Beacon default
-- (same word + same severity). Any school-added word that isn't in the
-- defaults stays untouched — so a future school that genuinely added
-- "snapchat" or similar won't lose it.
--
-- Safe to re-run: the DELETE becomes a no-op once duplicates are gone.
-- Reversible: the words remain enforced via beacon_default_policies, so
-- nothing is lost from the safeguarding pipeline.
--
-- Note: if a trigger logs deletes into policy_audit_log, this will create
-- one "removed" entry per deleted row. That's acceptable noise for a
-- one-off platform migration; the audit log is school-facing and the
-- cleanup happened on the platform, not by the school.
--
-- Run this in the Supabase SQL editor after 0015_seed_beacon_defaults.sql.

DO $$
DECLARE
  deleted_count integer;
BEGIN
  WITH removed AS (
    DELETE FROM beacon_policies bp
    USING beacon_default_policies bdp
    WHERE bp.word     = bdp.word
      AND bp.severity = bdp.severity
    RETURNING bp.id
  )
  SELECT count(*) INTO deleted_count FROM removed;

  RAISE NOTICE 'Cleared % duplicate school-policy rows (matched beacon_default_policies)', deleted_count;
END $$;

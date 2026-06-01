-- Beacon Default keyword policies — two-layer model.
--
-- Today every school owns its own flat list in `beacon_policies`. The
-- chat API and extension also reference a stale hardcoded HIGH_RISK /
-- MEDIUM_RISK array in code.
--
-- This migration introduces a centrally-managed default list
-- (`beacon_default_policies`) that every school inherits unless the
-- school opts out. Schools can still add their own words on top via the
-- existing `beacon_policies` table.
--
-- Behaviour change is gated by school_settings.use_beacon_defaults
-- (default TRUE). Without Phase 2 (chat API + extension wiring) the new
-- table exists but is not consulted yet — this migration is safe to run
-- standalone.
--
-- Hard-floor keywords (jailbreak phrases + the absolute-worst
-- safeguarding terms) remain hardcoded in app/api/chat/route.ts and
-- cannot be disabled, even with use_beacon_defaults = false.
--
-- Run this in the Supabase SQL editor after 0013_school_religious_affiliation.sql.

------------------------------------------------------------------------------
-- 1. beacon_default_policies — central, Beacon-managed default keyword list.
--    No school_id; one row applies to every tenant.
------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS beacon_default_policies (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  word        text        NOT NULL,
  severity    text        NOT NULL CHECK (severity IN ('high', 'medium')),
  category    text,                              -- optional grouping (e.g. 'drug_slang', 'gang_language', 'sexual_content')
  created_at  timestamptz NOT NULL DEFAULT now(),
  revised_at  timestamptz                        -- bumped when Beacon edits the row; null if untouched since insert
);

-- Prevent the same word being defined at two severities, and let the seed
-- migration use ON CONFLICT DO NOTHING for idempotent re-runs.
CREATE UNIQUE INDEX IF NOT EXISTS beacon_default_policies_word_severity_uniq
  ON beacon_default_policies (word, severity);

-- Lookup-by-severity is the only query pattern (chat API fetches the whole
-- list per request; not worth a multi-column index beyond the unique above).
CREATE INDEX IF NOT EXISTS beacon_default_policies_severity_idx
  ON beacon_default_policies (severity);

COMMENT ON TABLE beacon_default_policies IS
  'Beacon-managed default keyword policies applied to every school where '
  'school_settings.use_beacon_defaults = true. School-specific additions live '
  'in beacon_policies. Hard-floor safety keywords (jailbreak + critical '
  'safeguarding) remain hardcoded in the chat API and are not stored here.';

-- Row Level Security: this table is central infrastructure — a stray write
-- from one school's anon-key client would affect every other school. Lock
-- writes to service_role only; reads stay open to anon + authenticated so
-- the Atlas UI, chat API, and extension can all consume it.
--
-- service_role bypasses RLS automatically, so no explicit INSERT/UPDATE/
-- DELETE policy is needed — the absence of one means anon/authenticated
-- writes are denied by default.

ALTER TABLE beacon_default_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY beacon_default_policies_read_all
  ON beacon_default_policies
  FOR SELECT
  TO anon, authenticated
  USING (true);

------------------------------------------------------------------------------
-- 2. school_settings.use_beacon_defaults — per-school opt-in toggle.
--    Default TRUE so existing and new schools inherit the Beacon defaults.
------------------------------------------------------------------------------

ALTER TABLE school_settings
  ADD COLUMN IF NOT EXISTS use_beacon_defaults boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN school_settings.use_beacon_defaults IS
  'When true, the chat API and extension merge beacon_default_policies into '
  'the match set for this school. When false, only the school''s own '
  'beacon_policies rows and the hardcoded hard-floor keywords are enforced.';

-- Backfill is implicit via DEFAULT true, but make it explicit so a re-run
-- of this migration doesn''t leave any row with NULL if the column
-- existed previously without a default.
UPDATE school_settings
SET    use_beacon_defaults = true
WHERE  use_beacon_defaults IS NULL;

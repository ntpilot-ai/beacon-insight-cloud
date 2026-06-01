-- School religious affiliation — context for Horizon AI responses.
--
-- Adds a single nullable column to school_settings. Stored as a short slug
-- (e.g. 'cofe', 'catholic', 'none') so the chat API can map it to a
-- human-readable name in the system prompt without doing string parsing on
-- whatever the educator typed.
--
-- The slug list is enforced by the Atlas UI dropdown, not by a CHECK
-- constraint — keeping it open so we can extend the list without a schema
-- migration each time. NULL or unknown values mean "no affiliation context",
-- and the chat API silently omits the school-context block.
--
-- Run this in the Supabase SQL editor after 0012_pulse_term_snapshots_peak.sql.

ALTER TABLE school_settings
  ADD COLUMN IF NOT EXISTS religious_affiliation text;

COMMENT ON COLUMN school_settings.religious_affiliation IS
  'Slug for the school''s religious character (e.g. cofe, catholic, muslim, none). '
  'Consumed by the Horizon chat API to add school-context to the AI system prompt. '
  'NULL = no context injected.';

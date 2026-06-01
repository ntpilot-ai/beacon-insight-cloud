-- Aegis signal decoupling — Step 1 (additive).
-- See beacon-aegis-signal-decoupling-spec.md.
--
-- /api/classify (Claude Haiku) already returns { risk, category, reason }, but
-- beacon_events had nowhere to store category/reason, so the structured Aegis
-- signal was discarded at the events table and Pulse re-derived a cruder
-- category from the `matched` keyword array. These columns let Aegis store the
-- signal it already produces, so the keyword matcher can later be swapped for
-- the full LLM Aegis as a back-end change nothing downstream sees.
--
-- This migration is ADDITIVE ONLY — old code ignores the new columns, so it is
-- safe to apply any time ahead of the code deploy. The vocabulary cutover
-- (acks/snapshots Title Case -> snake_case) is a SEPARATE migration, 0018,
-- which must coincide with the Step 4 code deploy.
--
-- Run this in the Supabase SQL editor after 0016_clear_duplicate_school_policies.sql.

------------------------------------------------------------------------------
-- 1. Columns
------------------------------------------------------------------------------

-- Nullable by design: the keyword path legitimately produces 'general', and a
-- NOT NULL constraint would fight the backfill below.
alter table public.beacon_events add column if not exists category    text;
alter table public.beacon_events add column if not exists rationale   text;
alter table public.beacon_events add column if not exists risk_source text default 'keyword';
-- Optional, add when the model emits it:
-- alter table public.beacon_events add column if not exists confidence numeric;

------------------------------------------------------------------------------
-- 2. Backfill category for existing rows
------------------------------------------------------------------------------
-- Faithfully reproduces the CURRENT clusterCategories keyword logic, mapped to
-- canonical snake_case, so the Step 4 Pulse repoint is a no-op on historical
-- data (regression-safe).
--
-- IMPORTANT: this CASE is kept character-for-character and order-for-order
-- identical to categoryFromMatched in app/api/chat/route.ts. Both are
-- first-match-wins; if they diverge, a prompt that matches more than one bucket
-- gets categorised one way in history and another way live.
--
-- NOTE: the substring tests below (e.g. 'dan', 'coke', 'hurt') are imprecise by
-- design — they mirror the existing engine exactly. The LLM path fixes this
-- going forward; we are not "improving" history here, only preserving behaviour.
--
-- NOTE on provenance: risk_source = 'keyword' on backfilled rows is APPROXIMATE.
-- Historical extension events were often risk-classified by the LLM
-- (/api/classify), but because category was never stored we cannot reconstruct
-- which rows were LLM vs keyword. 'keyword' is a lossy-but-reasonable default
-- for all pre-migration rows; the flag is exact only from this migration forward.
update public.beacon_events
set category = case
  when array_to_string(matched, ' ') ilike any (array['%jailbreak%','%ignore%','%dan%','%bypass%'])       then 'jailbreak'
  when array_to_string(matched, ' ') ilike any (array['%harm%','%suicide%','%hurt%'])                      then 'self_harm'
  when array_to_string(matched, ' ') ilike any (array['%bully%','%threaten%'])                             then 'bullying'
  when array_to_string(matched, ' ') ilike any (array['%weapon%','%violen%','%shank%','%stab%'])           then 'violence'
  when array_to_string(matched, ' ') ilike any (array['%sex%','%explicit%','%adult%','%porn%','%nude%'])   then 'inappropriate_content'
  when array_to_string(matched, ' ') ilike any (array['%drug%','%alcohol%','%weed%','%coke%'])             then 'substance'
  else 'general'
end,
risk_source = 'keyword'
where category is null;

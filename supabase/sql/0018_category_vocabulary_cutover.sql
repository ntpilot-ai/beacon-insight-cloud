-- Aegis signal decoupling — Step 5 (vocabulary cutover).
-- See beacon-aegis-signal-decoupling-spec.md.
--
-- Acks and term snapshots stored their dominant category in Title Case (the
-- pre-decoupling clusterCategories output: "Self-harm", "Jailbreak", ...). Once
-- the Step 4 code change makes clusterCategories emit canonical snake_case, v3
-- re_emergence — which matches these strings by equality — silently stops
-- firing for every student acknowledged before the cutover. This migration
-- converts the existing Title Case values to snake_case so equality keeps
-- holding across the repoint.
--
-- DEPLOY ORDERING: 0017 (additive) should already be applied. THIS migration
-- and the Step 4 code repoint go out TOGETHER. Any ack written by old code
-- after this runs but before the new code deploys would re-introduce Title
-- Case — so apply this at cutover and deploy immediately. The conversion is
-- idempotent (it only rewrites known Title Case literals), so re-running it is
-- safe insurance.
--
-- Run this in the Supabase SQL editor at code-deploy time.

------------------------------------------------------------------------------
-- 1. pulse_acknowledgements.dominant_category (scalar)
------------------------------------------------------------------------------

update public.pulse_acknowledgements
set dominant_category = case dominant_category
  when 'General'                then 'general'
  when 'Jailbreak'              then 'jailbreak'
  when 'Self-harm'              then 'self_harm'
  when 'Bullying'               then 'bullying'
  when 'Violence'               then 'violence'
  when 'Inappropriate Content'  then 'inappropriate_content'
  when 'Substance'              then 'substance'
  else dominant_category
end
where dominant_category is not null;

------------------------------------------------------------------------------
-- 2. pulse_term_snapshots.dominant_categories (text[])
------------------------------------------------------------------------------

update public.pulse_term_snapshots
set dominant_categories = (
  select array_agg(case x
    when 'General'                then 'general'
    when 'Jailbreak'              then 'jailbreak'
    when 'Self-harm'              then 'self_harm'
    when 'Bullying'               then 'bullying'
    when 'Violence'               then 'violence'
    when 'Inappropriate Content'  then 'inappropriate_content'
    when 'Substance'              then 'substance'
    else x
  end)
  from unnest(dominant_categories) as x
)
where dominant_categories is not null and array_length(dominant_categories, 1) > 0;

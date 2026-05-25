-- Switch the LLM semantic pass from automatic to teacher-on-demand.
--
-- The sentiment pre-filter still runs automatically on every triggered
-- settled session. But the Claude Haiku pass — which produces context_risk,
-- sentiment_arc, concern_summary, requires_review, reasoning, and
-- behavioural_indicators — now only runs when a staff member explicitly
-- clicks "Run AI context analysis" on a flagged session in Pulse.
--
-- Audit trail captures who triggered the LLM and when. Existing rows that
-- were analysed automatically (pre this migration) are backfilled so they
-- read as "previously analysed" rather than offering the Run AI button.
--
-- Run this in the Supabase SQL editor after 0003_session_sentiment.sql.

alter table public.beacon_session_analysis
  add column if not exists llm_requested_by text,
  add column if not exists llm_requested_at timestamptz;

-- Backfill rows that already have LLM verdicts. Without this, the manual
-- button would re-offer analysis on every old row.
update public.beacon_session_analysis
   set llm_requested_by = 'auto-analysed-pre-manual-gate',
       llm_requested_at = analyzed_at
 where escalated_to_llm = true
   and model_version <> 'sentiment-only'
   and llm_requested_at is null;

-- UPDATE policy needed so the run-llm endpoint can patch the row with
-- LLM verdicts after the teacher clicks. Matches the anon-write pattern
-- used elsewhere in the project — see RLS-tightening TODO in CLAUDE.md.
drop policy if exists "anon update session_analysis" on public.beacon_session_analysis;
create policy "anon update session_analysis"
  on public.beacon_session_analysis for update
  using (true)
  with check (true);

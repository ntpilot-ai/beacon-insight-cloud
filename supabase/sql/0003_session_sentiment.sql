-- Sentiment pre-filter layer for beacon_session_analysis.
--
-- Every triggered session gets a lightweight rule-based sentiment score
-- (cheap, local, no API cost). Only sessions whose sentiment trajectory
-- crosses a concern threshold escalate to the full Claude Haiku pass.
-- Sentiment-only rows store sentiment_score/messages/trend and leave the
-- LLM verdict columns null.
--
-- Run this in the Supabase SQL editor after 0002_beacon_session_analysis.sql.

-- LLM verdict columns must accept null for sentiment-only rows
alter table public.beacon_session_analysis
  alter column context_risk  drop not null,
  alter column sentiment_arc drop not null;

alter table public.beacon_session_analysis
  add column if not exists sentiment_score    numeric,
  add column if not exists sentiment_messages numeric[] not null default '{}',
  add column if not exists sentiment_trend    text
    check (sentiment_trend is null
      or   sentiment_trend in ('deteriorating','improving','stable','volatile')),
  add column if not exists escalated_to_llm   boolean   not null default true;

-- Existing rows were always LLM-analysed, so the default of true is correct
-- for them. New rows set this explicitly from the API.

-- Brief 6: Multi-Student Cluster Detection
-- Creates student_clusters and cluster_triage_results tables.
-- cluster_key is a deterministic dedup key per type+category (or type+keyword)
-- so daily re-runs upsert rather than insert duplicates.
-- detected_date (plain date) is used for the unique index rather than an
-- expression on detected_at (timestamptz::date is not IMMUTABLE in Postgres).
--
-- Run after 0008_snooze_baseline.sql.

create table if not exists public.student_clusters (
  id                uuid        primary key default gen_random_uuid(),
  school_id         text        not null,
  cluster_key       text        not null,    -- dedup: "{type}:{category_or_keyword}"
  detected_at       timestamptz not null default now(),
  detected_date     date        not null default current_date,
  cluster_type      text        not null,
  student_ids       text[]      not null,
  student_count     int         not null,
  category          text        not null,
  time_window_hours numeric     not null,
  group_context     text,
  severity          text        not null,
  summary           text        not null,
  individual_pulses text[]      not null,
  requires_review   boolean     not null default false,
  dismissed_at      timestamptz,
  dismissed_by      text,
  acknowledged_at   timestamptz,
  acknowledged_by   text,
  acknowledged_note text,

  constraint student_clusters_type_check
    check (cluster_type in ('category_spike','coordinated_jailbreak','keyword_co-occurrence','sentiment_wave')),
  constraint student_clusters_severity_check
    check (severity in ('notable','significant','critical'))
);

create unique index if not exists student_clusters_dedup
  on public.student_clusters (school_id, cluster_key, detected_date);

create index if not exists student_clusters_school_date
  on public.student_clusters (school_id, detected_at desc);

create table if not exists public.cluster_triage_results (
  id                uuid        primary key default gen_random_uuid(),
  school_id         text        not null,
  cluster_id        uuid        not null references public.student_clusters(id) on delete cascade,
  triaged_at        timestamptz not null default now(),
  triage            text        not null,
  concern_summary   text        not null,
  suggested_action  text        not null,
  notify_immediately boolean    not null default false,
  reasoning         text,
  model_version     text,
  requested_by      text,

  constraint cluster_triage_level_check
    check (triage in ('notable','significant','critical'))
);

create index if not exists cluster_triage_cluster_id
  on public.cluster_triage_results (cluster_id);

-- RLS: anon can read and insert (same pattern as other pulse tables)
alter table public.student_clusters       enable row level security;
alter table public.cluster_triage_results enable row level security;

create policy "anon_read_clusters"
  on public.student_clusters for select using (true);

create policy "anon_insert_clusters"
  on public.student_clusters for insert with check (true);

create policy "anon_update_clusters"
  on public.student_clusters for update using (true);

create policy "anon_read_cluster_triage"
  on public.cluster_triage_results for select using (true);

create policy "anon_insert_cluster_triage"
  on public.cluster_triage_results for insert with check (true);

-- STACKD TRADER — Day 3: AI Brain schema additions.
-- Run AFTER 003_anon_dashboard_read.sql.

-- ============================================================================
-- claude_calls: per-call log for cost tracking + debugging
-- ============================================================================

create type claude_call_type as enum (
  'sentiment',
  'signal_explain',
  'morning_brief',
  'evening_report',
  'anomaly_check',
  'regime_classify'
);

create table if not exists public.claude_calls (
  id              uuid primary key default gen_random_uuid(),
  call_type       claude_call_type not null,
  model           text             not null,
  input_tokens    integer          not null default 0,
  output_tokens   integer          not null default 0,
  cache_read_tokens   integer      not null default 0,
  cache_write_tokens  integer      not null default 0,
  cost_usd        numeric(10, 6)   not null default 0,
  duration_ms     integer          not null default 0,
  success         boolean          not null default true,
  error_message   text,
  context         jsonb,
  created_at      timestamptz      not null default now()
);

create index if not exists claude_calls_recent_idx
  on public.claude_calls (created_at desc);
create index if not exists claude_calls_type_recent_idx
  on public.claude_calls (call_type, created_at desc);

alter table public.claude_calls enable row level security;

create policy "service role full access claude_calls"
  on public.claude_calls for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "public read claude_calls"
  on public.claude_calls for select using (true);

-- ============================================================================
-- anomalies: persisted anomaly detections (drives the dashboard alert)
-- ============================================================================

create type anomaly_severity as enum ('low', 'medium', 'high', 'critical');
create type anomaly_action   as enum ('continue', 'reduce_exposure', 'pause_bot', 'close_positions');

create table if not exists public.anomalies (
  id                    uuid primary key default gen_random_uuid(),
  mode                  trade_mode        not null,
  severity              anomaly_severity  not null,
  anomaly_type          text,
  description           text,
  recommended_action    anomaly_action    not null default 'continue',
  affects_instruments   text[]            not null default '{}',
  context               jsonb,
  acknowledged_at       timestamptz,
  acknowledged_by       text,
  created_at            timestamptz       not null default now()
);

create index if not exists anomalies_recent_idx
  on public.anomalies (created_at desc);
create index if not exists anomalies_open_critical_idx
  on public.anomalies (severity, acknowledged_at) where acknowledged_at is null;

alter table public.anomalies enable row level security;

create policy "service role full access anomalies"
  on public.anomalies for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "public read anomalies"
  on public.anomalies for select using (true);

alter publication supabase_realtime add table public.anomalies;
alter publication supabase_realtime add table public.claude_calls;
alter publication supabase_realtime add table public.daily_summaries;

-- ============================================================================
-- daily_summaries: add morning_brief and evening_report payloads
-- ============================================================================

alter table public.daily_summaries
  add column if not exists morning_brief    jsonb,
  add column if not exists morning_read_at  timestamptz,
  add column if not exists evening_report   jsonb,
  add column if not exists evening_read_at  timestamptz;

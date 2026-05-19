-- STACKD TRADER — Day 5: paper-trading activation columns.
-- Run AFTER 005_day4_execution.sql.

alter table public.bot_status
  add column if not exists paper_started_at         timestamptz,
  add column if not exists paper_starting_balance   numeric(18, 2);

-- Compliance approvals log (for the morning manual-approval button + daily audit history)
create table if not exists public.compliance_approvals (
  id                uuid primary key default gen_random_uuid(),
  mode              trade_mode  not null,
  date              date        not null,
  morning_approved  boolean     not null default false,
  morning_at        timestamptz,
  approved_by       text,
  morning_failed    text[]      not null default '{}',
  evening_audit     jsonb,
  rule_violations   text[]      not null default '{}',
  created_at        timestamptz not null default now(),
  unique (mode, date)
);

create index if not exists compliance_approvals_recent_idx
  on public.compliance_approvals (mode, date desc);

alter table public.compliance_approvals enable row level security;

create policy "service role full access compliance_approvals"
  on public.compliance_approvals for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "public read compliance_approvals"
  on public.compliance_approvals for select using (true);

-- Strategy enable/disable flags (per-mode, per-strategy)
create table if not exists public.strategy_flags (
  id            uuid primary key default gen_random_uuid(),
  mode          trade_mode      not null,
  strategy      trade_strategy  not null,
  is_enabled    boolean         not null default true,
  updated_at    timestamptz     not null default now(),
  unique (mode, strategy)
);

alter table public.strategy_flags enable row level security;

create policy "service role full access strategy_flags"
  on public.strategy_flags for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "public read strategy_flags"
  on public.strategy_flags for select using (true);

-- Seed all three strategies enabled for every mode.
insert into public.strategy_flags (mode, strategy, is_enabled) values
  ('paper',        'momentum',       true),
  ('paper',        'mean_reversion', true),
  ('paper',        'news_sentiment', true),
  ('live_crypto',  'momentum',       true),
  ('live_crypto',  'mean_reversion', true),
  ('live_crypto',  'news_sentiment', true),
  ('live_futures', 'momentum',       true),
  ('live_futures', 'mean_reversion', true),
  ('live_futures', 'news_sentiment', true),
  ('topstep',      'momentum',       true),
  ('topstep',      'mean_reversion', true),
  ('topstep',      'news_sentiment', true)
on conflict (mode, strategy) do nothing;

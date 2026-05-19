-- STACKD TRADER — Initial Schema
-- All trading data, signals, daily rollups, live bot state, and risk config.
-- Run as a single block in the Supabase SQL editor.

-- ============================================================================
-- ENUMS
-- ============================================================================

create type trade_mode as enum ('paper', 'live_crypto', 'live_futures', 'topstep');
create type trade_strategy as enum ('momentum', 'mean_reversion', 'news_sentiment');
create type trade_status as enum ('open', 'closed', 'cancelled');
create type signal_action as enum ('enter', 'skip');
create type market_regime as enum ('trending', 'ranging', 'high_volatility', 'extreme_volatility', 'low_volatility');

-- ============================================================================
-- TRADES
-- ============================================================================

create table public.trades (
  id                uuid primary key default gen_random_uuid(),
  mode              trade_mode      not null,
  strategy          trade_strategy  not null,
  instrument        text            not null,
  entry_price       numeric(18, 8)  not null,
  exit_price        numeric(18, 8),
  stop_loss         numeric(18, 8)  not null,
  take_profit       numeric(18, 8)  not null,
  quantity          numeric(18, 8)  not null,
  status            trade_status    not null default 'open',
  pnl               numeric(18, 8)  not null default 0,
  signal_score      numeric(6, 2),
  claude_reasoning  text,
  entry_time        timestamptz     not null default now(),
  exit_time         timestamptz,
  created_at        timestamptz     not null default now()
);

create index trades_mode_status_idx      on public.trades (mode, status);
create index trades_mode_entry_time_idx  on public.trades (mode, entry_time desc);
create index trades_instrument_idx       on public.trades (instrument);

-- ============================================================================
-- SIGNALS
-- ============================================================================

create table public.signals (
  id                  uuid primary key default gen_random_uuid(),
  mode                trade_mode      not null,
  instrument          text            not null,
  strategy            trade_strategy  not null,
  rsi                 numeric(6, 2),
  macd                numeric(10, 4),
  volume_ratio        numeric(8, 3),
  key_level_break     boolean         not null default false,
  sentiment_score     numeric(6, 2),
  total_score         numeric(6, 2)   not null,
  action              signal_action   not null,
  claude_explanation  text,
  created_at          timestamptz     not null default now()
);

create index signals_mode_created_idx on public.signals (mode, created_at desc);
create index signals_action_idx       on public.signals (action);

-- ============================================================================
-- DAILY SUMMARIES
-- ============================================================================

create table public.daily_summaries (
  id                  uuid primary key default gen_random_uuid(),
  mode                trade_mode  not null,
  date                date        not null,
  total_trades        integer     not null default 0,
  winners             integer     not null default 0,
  losers              integer     not null default 0,
  gross_pnl           numeric(18, 8) not null default 0,
  win_rate            numeric(5, 2)  not null default 0,
  drawdown_pct        numeric(5, 2)  not null default 0,
  compliance_passed   boolean     not null default true,
  topstep_notes       text,
  created_at          timestamptz not null default now(),
  unique (mode, date)
);

create index daily_summaries_mode_date_idx on public.daily_summaries (mode, date desc);

-- ============================================================================
-- BOT STATUS  (one row per mode)
-- ============================================================================

create table public.bot_status (
  id                       uuid primary key default gen_random_uuid(),
  mode                     trade_mode    not null unique,
  is_active                boolean       not null default false,
  regime                   market_regime not null default 'ranging',
  daily_pnl                numeric(18, 8) not null default 0,
  daily_trades             integer        not null default 0,
  daily_loss_limit_hit     boolean        not null default false,
  last_updated             timestamptz    not null default now()
);

-- Seed one bot_status row per mode so the dashboard always has something to read.
insert into public.bot_status (mode) values
  ('paper'),
  ('live_crypto'),
  ('live_futures'),
  ('topstep')
on conflict (mode) do nothing;

-- ============================================================================
-- RISK SETTINGS  (one row per mode)
-- ============================================================================

create table public.risk_settings (
  id                          uuid primary key default gen_random_uuid(),
  mode                        trade_mode    not null unique,
  max_risk_per_trade_pct      numeric(5, 2) not null default 1.00,
  daily_loss_limit_pct        numeric(5, 2) not null default 3.00,
  profit_target_pct           numeric(5, 2) not null default 6.00,
  max_contracts               integer        not null default 1,
  is_topstep_mode             boolean        not null default false,
  topstep_daily_loss_limit    numeric(18, 2) not null default 1000.00,
  topstep_max_drawdown        numeric(18, 2) not null default 2000.00,
  topstep_profit_target       numeric(18, 2) not null default 3000.00,
  updated_at                  timestamptz    not null default now()
);

insert into public.risk_settings (mode, is_topstep_mode, max_contracts) values
  ('paper',        false, 5),
  ('live_crypto',  false, 1),
  ('live_futures', false, 2),
  ('topstep',      true,  2)
on conflict (mode) do nothing;

-- ============================================================================
-- updated_at trigger for risk_settings + bot_status
-- ============================================================================

create or replace function public.touch_last_updated() returns trigger as $$
begin
  new.last_updated := now();
  return new;
end;
$$ language plpgsql;

create or replace function public.touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger bot_status_touch
  before update on public.bot_status
  for each row execute function public.touch_last_updated();

create trigger risk_settings_touch
  before update on public.risk_settings
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Single-operator app — RLS on, service role used from server. If you later add
-- multi-tenant access, replace these with auth.uid()-scoped policies.

alter table public.trades            enable row level security;
alter table public.signals           enable row level security;
alter table public.daily_summaries   enable row level security;
alter table public.bot_status        enable row level security;
alter table public.risk_settings     enable row level security;

create policy "service role full access trades"
  on public.trades for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "service role full access signals"
  on public.signals for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "service role full access daily_summaries"
  on public.daily_summaries for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "service role full access bot_status"
  on public.bot_status for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "service role full access risk_settings"
  on public.risk_settings for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Authenticated read for the dashboard (no writes from the browser).
create policy "auth read trades"           on public.trades           for select using (auth.role() = 'authenticated');
create policy "auth read signals"          on public.signals          for select using (auth.role() = 'authenticated');
create policy "auth read daily_summaries"  on public.daily_summaries  for select using (auth.role() = 'authenticated');
create policy "auth read bot_status"       on public.bot_status       for select using (auth.role() = 'authenticated');
create policy "auth read risk_settings"    on public.risk_settings    for select using (auth.role() = 'authenticated');

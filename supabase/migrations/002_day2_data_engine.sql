-- STACKD TRADER — Day 2: Data Engine schema additions.
-- Run this AFTER 001_initial_schema.sql.

-- ============================================================================
-- New enum: trade direction (long / short)
-- ============================================================================

create type trade_direction as enum ('long', 'short');

-- ============================================================================
-- signals: add Day 2 columns
-- ============================================================================

alter table public.signals
  add column if not exists direction       trade_direction,
  add column if not exists atr             numeric(18, 8),
  add column if not exists regime          market_regime,
  add column if not exists raw_score       numeric(6, 2),
  add column if not exists macd_histogram  numeric(10, 4);

-- ============================================================================
-- news: persisted headlines from Polygon, scored later by Claude
-- ============================================================================

create table if not exists public.news (
  id              uuid primary key default gen_random_uuid(),
  instrument      text,                                  -- null = general market news
  title           text not null,
  summary         text,
  url             text,
  source          text,
  sentiment_score numeric(5, 2),                         -- -1.00 .. 1.00
  published_at    timestamptz not null,
  created_at      timestamptz not null default now(),
  unique (url)                                            -- dedupe on URL
);

create index if not exists news_published_idx
  on public.news (published_at desc);
create index if not exists news_instrument_published_idx
  on public.news (instrument, published_at desc);

alter table public.news enable row level security;

create policy "service role full access news"
  on public.news for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "auth read news"
  on public.news for select using (auth.role() = 'authenticated');

-- ============================================================================
-- calendar_events: economic calendar persisted daily
-- ============================================================================

create table if not exists public.calendar_events (
  id           uuid primary key default gen_random_uuid(),
  event        text        not null,
  country      text,
  impact       text,                  -- 'low' | 'medium' | 'high'
  scheduled_at timestamptz not null,
  actual       text,
  forecast     text,
  previous     text,
  created_at   timestamptz not null default now(),
  unique (event, scheduled_at)
);

create index if not exists calendar_scheduled_idx
  on public.calendar_events (scheduled_at);
create index if not exists calendar_impact_scheduled_idx
  on public.calendar_events (impact, scheduled_at);

alter table public.calendar_events enable row level security;

create policy "service role full access calendar"
  on public.calendar_events for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "auth read calendar"
  on public.calendar_events for select using (auth.role() = 'authenticated');

-- ============================================================================
-- bot_event_log: structured event log (regime changes, kill switch, errors)
-- ============================================================================

create table if not exists public.bot_event_log (
  id         uuid primary key default gen_random_uuid(),
  mode       trade_mode  not null,
  level      text        not null default 'info',  -- 'info' | 'warn' | 'error'
  category   text        not null,                 -- 'regime' | 'stream' | 'signal' | 'order' | 'system'
  message    text        not null,
  context    jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bot_event_log_recent_idx
  on public.bot_event_log (created_at desc);
create index if not exists bot_event_log_mode_category_idx
  on public.bot_event_log (mode, category, created_at desc);

alter table public.bot_event_log enable row level security;

create policy "service role full access bot_event_log"
  on public.bot_event_log for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "auth read bot_event_log"
  on public.bot_event_log for select using (auth.role() = 'authenticated');

-- ============================================================================
-- Enable Supabase realtime for tables the dashboard subscribes to
-- ============================================================================

alter publication supabase_realtime add table public.signals;
alter publication supabase_realtime add table public.bot_status;
alter publication supabase_realtime add table public.trades;
alter publication supabase_realtime add table public.news;
alter publication supabase_realtime add table public.bot_event_log;

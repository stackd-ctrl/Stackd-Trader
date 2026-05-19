-- STACKD TRADER — Day 4: Execution engine schema additions.
-- Run AFTER 004_day3_ai_brain.sql.

-- ============================================================================
-- risk_guard_log: every passesRiskGuard call (approved + blocked)
-- ============================================================================

create type risk_guard_decision as enum ('approved', 'blocked', 'adjusted');

create table if not exists public.risk_guard_log (
  id                  uuid primary key default gen_random_uuid(),
  mode                trade_mode      not null,
  instrument          text            not null,
  strategy            trade_strategy  not null,
  decision            risk_guard_decision not null,
  failed_check        text,
  reason              text,
  proposed_size       numeric(18, 8),
  adjusted_size       numeric(18, 8),
  proposed_entry      numeric(18, 8),
  proposed_stop       numeric(18, 8),
  context             jsonb,
  created_at          timestamptz     not null default now()
);

create index if not exists risk_guard_log_recent_idx
  on public.risk_guard_log (created_at desc);
create index if not exists risk_guard_log_mode_idx
  on public.risk_guard_log (mode, created_at desc);

alter table public.risk_guard_log enable row level security;

create policy "service role full access risk_guard_log"
  on public.risk_guard_log for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "public read risk_guard_log"
  on public.risk_guard_log for select using (true);

-- ============================================================================
-- account_snapshots: daily peak equity for drawdown calc + Topstep audit
-- ============================================================================

create table if not exists public.account_snapshots (
  id            uuid primary key default gen_random_uuid(),
  mode          trade_mode      not null,
  equity        numeric(18, 2)  not null,
  cash          numeric(18, 2)  not null,
  buying_power  numeric(18, 2)  not null,
  peak_equity   numeric(18, 2)  not null,
  drawdown_pct  numeric(5, 2)   not null default 0,
  snapshot_at   timestamptz     not null default now(),
  unique (mode, snapshot_at)
);

create index if not exists account_snapshots_mode_recent_idx
  on public.account_snapshots (mode, snapshot_at desc);

alter table public.account_snapshots enable row level security;

create policy "service role full access account_snapshots"
  on public.account_snapshots for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "public read account_snapshots"
  on public.account_snapshots for select using (true);

-- ============================================================================
-- trades: add columns for direction, broker order ids, bracket order ids
-- ============================================================================

alter table public.trades
  add column if not exists direction            trade_direction,
  add column if not exists entry_order_id       text,
  add column if not exists stop_order_id        text,
  add column if not exists target_order_id      text,
  add column if not exists exit_reason          text,
  add column if not exists contract_multiplier  numeric(10, 4) not null default 1;

-- ============================================================================
-- bot_status: track pause-until timestamp for consecutive loss freeze
-- ============================================================================

alter table public.bot_status
  add column if not exists paused_until         timestamptz,
  add column if not exists consecutive_losses   integer not null default 0;

alter publication supabase_realtime add table public.risk_guard_log;

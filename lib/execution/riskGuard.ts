// STACKD TRADER — Risk guard. Runs before EVERY trade entry. No overrides.
//
// Returns approved/blocked + a reason. Optionally returns adjustedSize when
// the position can be entered but at a smaller size (drawdown scaling, account
// cap). Every call logs to risk_guard_log for the audit trail.

import 'server-only';
import { supabaseService } from '@/lib/supabase';
import { instrumentByKey } from '@/lib/instruments';
import { isMarketHours, isCryptoSession } from '@/lib/time';
import { isBlackoutPeriod } from '@/lib/calendar/events';
import { getAccount } from '@/lib/alpaca/client';
import type {
  RiskGuardDecision,
  TradeMode,
  TradeStrategy,
} from '@/types/database';

export interface RiskGuardInput {
  mode: TradeMode;
  instrument: string;
  strategy: TradeStrategy;
  proposedEntry: number;
  proposedStop: number;
  proposedTarget: number;
  proposedSize: number;
}

export interface RiskGuardResult {
  approved: boolean;
  reason: string;
  failedCheck?: string;
  adjustedSize?: number;
}

const DAILY_TRADE_LIMIT = 10;
const MIN_REWARD_RISK = 1.6;
const MAX_RISK_PCT = 0.015;
const CONSECUTIVE_LOSS_LIMIT = 3;
const CONSECUTIVE_LOSS_PAUSE_MIN = 30;

export async function passesRiskGuard(input: RiskGuardInput): Promise<RiskGuardResult> {
  const inst = instrumentByKey(input.instrument);
  const isCrypto = inst?.class === 'crypto';
  const multiplier = inst?.contractMultiplier ?? 1;

  const sb = supabaseService();

  async function log(decision: RiskGuardDecision, failedCheck: string | null, reason: string, adjustedSize?: number) {
    try {
      await sb.from('risk_guard_log').insert({
        mode: input.mode,
        instrument: input.instrument,
        strategy: input.strategy,
        decision,
        failed_check: failedCheck,
        reason,
        proposed_size: input.proposedSize,
        adjusted_size: adjustedSize ?? null,
        proposed_entry: input.proposedEntry,
        proposed_stop: input.proposedStop,
        context: { target: input.proposedTarget },
      });
    } catch (err) {
      console.error('[riskGuard] failed to log result', err);
    }
  }

  // CHECK 1: Market hours (skip for crypto — 24/7).
  if (!isCrypto && !isMarketHours()) {
    const r = 'Outside trading hours';
    await log('blocked', 'market_hours', r);
    return { approved: false, reason: r, failedCheck: 'market_hours' };
  }
  if (isCrypto && !isCryptoSession()) {
    const r = 'Crypto session closed';
    await log('blocked', 'market_hours', r);
    return { approved: false, reason: r, failedCheck: 'market_hours' };
  }

  // CHECK 2: Economic calendar blackout.
  if (await isBlackoutPeriod()) {
    const r = 'Economic event blackout active';
    await log('blocked', 'blackout', r);
    return { approved: false, reason: r, failedCheck: 'blackout' };
  }

  // CHECK 3: Bot active status (and pause-until window from check 6).
  const { data: status, error: statusErr } = await sb
    .from('bot_status')
    .select('is_active, daily_pnl, daily_trades, daily_loss_limit_hit, paused_until, consecutive_losses')
    .eq('mode', input.mode)
    .single();
  if (statusErr || !status) {
    const r = 'Cannot read bot_status';
    await log('blocked', 'bot_status_read', r);
    return { approved: false, reason: r, failedCheck: 'bot_status_read' };
  }
  if (!status.is_active) {
    const r = 'Bot is paused';
    await log('blocked', 'bot_inactive', r);
    return { approved: false, reason: r, failedCheck: 'bot_inactive' };
  }
  if (status.paused_until && new Date(status.paused_until).getTime() > Date.now()) {
    const r = `Bot in cooldown until ${status.paused_until}`;
    await log('blocked', 'cooldown', r);
    return { approved: false, reason: r, failedCheck: 'cooldown' };
  }

  // CHECK 4: Daily loss limit.
  const { data: risk, error: riskErr } = await sb
    .from('risk_settings')
    .select('daily_loss_limit_pct')
    .eq('mode', input.mode)
    .single();
  if (riskErr || !risk) {
    const r = 'Cannot read risk_settings';
    await log('blocked', 'risk_settings_read', r);
    return { approved: false, reason: r, failedCheck: 'risk_settings_read' };
  }
  let accountBalance = 0;
  try {
    const acct = await getAccount();
    accountBalance = acct.equity;
  } catch (err) {
    console.warn('[riskGuard] getAccount failed; using paper-default balance', err);
    accountBalance = 100_000;
  }
  const dailyLossLimitDollars = (accountBalance * Number(risk.daily_loss_limit_pct)) / 100;
  if (status.daily_pnl <= -dailyLossLimitDollars) {
    // Flip the limit-hit flag once.
    if (!status.daily_loss_limit_hit) {
      await sb.from('bot_status').update({ daily_loss_limit_hit: true }).eq('mode', input.mode);
    }
    const r = 'Daily loss limit reached';
    await log('blocked', 'daily_loss_limit', r);
    return { approved: false, reason: r, failedCheck: 'daily_loss_limit' };
  }

  // CHECK 5: Daily trade limit.
  if (status.daily_trades >= DAILY_TRADE_LIMIT) {
    const r = 'Daily trade limit reached';
    await log('blocked', 'daily_trade_limit', r);
    return { approved: false, reason: r, failedCheck: 'daily_trade_limit' };
  }

  // CHECK 6: Consecutive loss check.
  const { data: lastTrades } = await sb
    .from('trades')
    .select('pnl, status')
    .eq('mode', input.mode)
    .eq('status', 'closed')
    .order('exit_time', { ascending: false })
    .limit(CONSECUTIVE_LOSS_LIMIT);
  if (lastTrades && lastTrades.length === CONSECUTIVE_LOSS_LIMIT &&
      lastTrades.every((t) => t.pnl < 0)) {
    const pauseUntil = new Date(Date.now() + CONSECUTIVE_LOSS_PAUSE_MIN * 60 * 1000).toISOString();
    await sb.from('bot_status').update({
      paused_until: pauseUntil,
      consecutive_losses: CONSECUTIVE_LOSS_LIMIT,
    }).eq('mode', input.mode);
    const r = `Three consecutive losses, pausing ${CONSECUTIVE_LOSS_PAUSE_MIN} minutes`;
    await log('blocked', 'consecutive_losses', r);
    return { approved: false, reason: r, failedCheck: 'consecutive_losses' };
  }

  // CHECK 7: Reward to risk ratio.
  const riskPoints = Math.abs(input.proposedEntry - input.proposedStop);
  const rewardPoints = Math.abs(input.proposedTarget - input.proposedEntry);
  const rr = riskPoints <= 0 ? 0 : rewardPoints / riskPoints;
  if (rr < MIN_REWARD_RISK) {
    const r = `Reward to risk ${rr.toFixed(2)} below minimum ${MIN_REWARD_RISK} threshold`;
    await log('blocked', 'reward_risk', r);
    return { approved: false, reason: r, failedCheck: 'reward_risk' };
  }

  // CHECK 8: Position size validation (max 1.5% of account).
  const dollarRiskPerUnit = riskPoints * multiplier;
  const maxDollarRisk = accountBalance * MAX_RISK_PCT;
  const proposedDollarRisk = dollarRiskPerUnit * input.proposedSize;
  let finalSize = input.proposedSize;

  if (proposedDollarRisk > maxDollarRisk) {
    const maxAllowed = Math.floor(maxDollarRisk / dollarRiskPerUnit);
    if (maxAllowed < 1) {
      const r = 'Position too large for current account balance';
      await log('blocked', 'position_size', r);
      return { approved: false, reason: r, failedCheck: 'position_size' };
    }
    finalSize = maxAllowed;
  }

  // CHECK 9: Existing position check.
  const { data: openOnInstrument } = await sb
    .from('trades')
    .select('id')
    .eq('mode', input.mode)
    .eq('instrument', input.instrument)
    .eq('status', 'open')
    .limit(1);
  if (openOnInstrument && openOnInstrument.length > 0) {
    const r = `Already have open position in ${input.instrument}`;
    await log('blocked', 'existing_position', r);
    return { approved: false, reason: r, failedCheck: 'existing_position' };
  }

  // CHECK 10: Drawdown scaling.
  const { data: snap } = await sb
    .from('account_snapshots')
    .select('peak_equity')
    .eq('mode', input.mode)
    .order('snapshot_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const peak = snap?.peak_equity ?? accountBalance;
  const drawdownPct = peak > 0 ? ((peak - accountBalance) / peak) * 100 : 0;

  if (drawdownPct > 10) {
    const r = 'Drawdown limit reached, bot paused for review';
    await log('blocked', 'drawdown_limit', r);
    return { approved: false, reason: r, failedCheck: 'drawdown_limit' };
  }
  if (drawdownPct > 8) {
    finalSize = Math.max(1, Math.floor(finalSize * 0.5));
  } else if (drawdownPct > 5) {
    finalSize = Math.max(1, Math.floor(finalSize * 0.75));
  }

  // All checks passed.
  const adjusted = finalSize !== input.proposedSize;
  await log(
    adjusted ? 'adjusted' : 'approved',
    null,
    adjusted ? `Size adjusted from ${input.proposedSize} to ${finalSize}` : 'All checks passed',
    adjusted ? finalSize : undefined,
  );
  return {
    approved: true,
    reason: adjusted ? `Approved (size adjusted to ${finalSize})` : 'Approved',
    adjustedSize: adjusted ? finalSize : undefined,
  };
}

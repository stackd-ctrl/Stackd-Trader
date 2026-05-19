// STACKD TRADER — Topstep-specific risk guard.
//
// Layers on top of passesRiskGuard for trade mode 'topstep'. Topstep evaluation
// rules are stricter: daily loss is HARD, drawdown is trailing, and there's a
// consistency rule capping any single day at 40% of total evaluation profit.

import 'server-only';
import { supabaseService } from '@/lib/supabase';
import { TOPSTEP_APPROVED_INSTRUMENTS } from '@/lib/instruments';
import type { RiskSettings, TradeMode } from '@/types/database';

export interface TopstepGuardInput {
  instrument: string;
  proposedTradeSize: number;
  currentAccountBalance: number;
  startingEvaluationBalance: number;
  topstepSettings: RiskSettings;
  minTradingDays?: number;
  daysTradedSoFar?: number;
}

export interface TopstepGuardResult {
  approved: boolean;
  reason: string;
  adjustedSize?: number;
  failedCheck?: string;
}

const DAILY_LOSS_BUFFER = 0.90;   // stop at 90% of limit (slippage headroom)
const DRAWDOWN_BUFFER = 0.90;
const CONSISTENCY_RULE_FRAC = 0.40;
const CONSISTENCY_HALF_FRAC = 0.35;

export async function passesTopstepGuard(input: TopstepGuardInput): Promise<TopstepGuardResult> {
  const sb = supabaseService();
  const mode: TradeMode = 'topstep';

  async function log(reason: string, approved: boolean, failedCheck?: string, adjustedSize?: number) {
    try {
      await sb.from('bot_event_log').insert({
        mode,
        level: approved ? 'info' : 'warn',
        category: 'system',
        message: `Topstep guard: ${reason}`,
        context: {
          instrument: input.instrument,
          approved,
          failed_check: failedCheck ?? null,
          adjusted_size: adjustedSize ?? null,
          proposed_size: input.proposedTradeSize,
          balance: input.currentAccountBalance,
          starting_balance: input.startingEvaluationBalance,
        },
      });
    } catch (err) {
      console.error('[topstepGuard] log failed', err);
    }
  }

  // CHECK 5 first (cheapest): approved instruments only.
  if (!TOPSTEP_APPROVED_INSTRUMENTS.has(input.instrument)) {
    const reason = `Instrument ${input.instrument} not approved for Topstep`;
    await log(reason, false, 'approved_instrument');
    return { approved: false, reason, failedCheck: 'approved_instrument' };
  }

  // Today's PnL — use bot_status.daily_pnl.
  const { data: status } = await sb
    .from('bot_status')
    .select('daily_pnl')
    .eq('mode', mode)
    .single();
  const todaysPnl = status?.daily_pnl ?? 0;

  const settings = input.topstepSettings;

  // CHECK 1: Daily loss limit (HARD; buffer at 90%).
  const dailyLossLimit = Number(settings.topstep_daily_loss_limit);
  const effectiveDailyLimit = dailyLossLimit * DAILY_LOSS_BUFFER;
  if (todaysPnl <= -effectiveDailyLimit) {
    const reason = `Topstep daily loss within 90% buffer: -$${(-todaysPnl).toFixed(2)} vs limit $${dailyLossLimit.toFixed(2)}`;
    await log(reason, false, 'daily_loss_buffer');
    return { approved: false, reason, failedCheck: 'daily_loss_buffer' };
  }

  // CHECK 2: Maximum drawdown (trailing peak).
  const maxDrawdown = Number(settings.topstep_max_drawdown);
  const effectiveDrawdownLimit = maxDrawdown * DRAWDOWN_BUFFER;
  // Pull the trailing peak from account_snapshots.
  const { data: snap } = await sb
    .from('account_snapshots')
    .select('peak_equity')
    .eq('mode', mode)
    .order('snapshot_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const peak = snap?.peak_equity ?? input.startingEvaluationBalance;
  const drawdownDollars = peak - input.currentAccountBalance;
  if (drawdownDollars >= effectiveDrawdownLimit) {
    const reason = `Topstep trailing drawdown within 90% buffer: $${drawdownDollars.toFixed(2)} vs limit $${maxDrawdown.toFixed(2)}`;
    await log(reason, false, 'drawdown_buffer');
    return { approved: false, reason, failedCheck: 'drawdown_buffer' };
  }

  // CHECK 3: Consistency rule.
  const totalEvalProfit = input.currentAccountBalance - input.startingEvaluationBalance;
  if (totalEvalProfit > 0) {
    const profitCap = totalEvalProfit * CONSISTENCY_RULE_FRAC;
    if (todaysPnl >= profitCap) {
      const reason = `Today's profit $${todaysPnl.toFixed(2)} hit consistency cap (40% of total $${totalEvalProfit.toFixed(2)}). No more trades today.`;
      await log(reason, false, 'consistency_cap');
      return { approved: false, reason, failedCheck: 'consistency_cap' };
    }
    const halfCap = totalEvalProfit * CONSISTENCY_HALF_FRAC;
    if (todaysPnl >= halfCap) {
      const half = Math.max(1, Math.floor(input.proposedTradeSize * 0.5));
      const reason = `Today's profit at 35% of total. Reducing size to ${half}.`;
      await log(reason, true, 'consistency_warn', half);
      return { approved: true, reason, adjustedSize: half };
    }
  }

  // CHECK 4: Minimum trading days — informational gate, not a block.
  if (input.minTradingDays !== undefined && input.daysTradedSoFar !== undefined) {
    const remaining = input.minTradingDays - input.daysTradedSoFar;
    if (remaining > 0) {
      // Logged for the dashboard, doesn't block.
      await log(`Min trading days: ${remaining} remaining`, true, undefined);
    }
  }

  await log('All Topstep checks passed', true);
  return { approved: true, reason: 'All Topstep checks passed' };
}

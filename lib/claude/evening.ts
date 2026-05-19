// STACKD TRADER — Evening performance report.
//
// Runs at 4:30pm ET via /api/cron/evening. Pulls the day's trades and signals
// out of Supabase, asks Claude for a graded summary with one actionable insight.

import 'server-only';
import { callClaude } from './client';
import { withTimeout } from './timeout';
import { supabaseService } from '@/lib/supabase';
import type { Trade, TradeMode, TradeStrategy } from '@/types/database';

const HARD_BUDGET_MS = 3_000;

export interface EveningInput {
  mode: TradeMode;
  trades_today: Trade[];
  signals_today_count: number;
  signals_skipped: number;
  regime_changes: string[];           // describable strings, e.g. 'ranging → trending at 10:14'
  final_pnl: number;
  win_rate: number;                   // 0..1
  best_trade: Trade | null;
  worst_trade: Trade | null;
  topstep_compliance: {
    daily_loss_breach: boolean;
    drawdown_breach: boolean;
    profit_target_progress: number;   // 0..1
  } | null;
}

export interface StrategyHealth {
  momentum: 'working' | 'struggling' | 'inactive';
  mean_reversion: 'working' | 'struggling' | 'inactive';
  news_sentiment: 'working' | 'struggling' | 'inactive';
}

export interface EveningReport {
  performance_grade: 'A' | 'B' | 'C' | 'D' | 'F';
  pnl_assessment: string;              // max 100
  strategy_breakdown: StrategyHealth;
  pattern_identified: string;          // max 150
  one_actionable_insight: string;      // max 200
  topstep_status: {
    on_track: boolean;
    notes: string;
  } | null;
  tomorrow_recommendation: 'normal' | 'conservative' | 'sit_out';
}

const STRATEGY_ENUM = { type: 'string', enum: ['working', 'struggling', 'inactive'] } as const;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    performance_grade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'F'] },
    pnl_assessment: { type: 'string', maxLength: 100 },
    strategy_breakdown: {
      type: 'object',
      additionalProperties: false,
      properties: {
        momentum:        STRATEGY_ENUM,
        mean_reversion:  STRATEGY_ENUM,
        news_sentiment:  STRATEGY_ENUM,
      },
      required: ['momentum', 'mean_reversion', 'news_sentiment'],
    },
    pattern_identified:     { type: 'string', maxLength: 150 },
    one_actionable_insight: { type: 'string', maxLength: 200 },
    topstep_status: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        on_track: { type: 'boolean' },
        notes:    { type: 'string' },
      },
      required: ['on_track', 'notes'],
    },
    tomorrow_recommendation: { type: 'string', enum: ['normal', 'conservative', 'sit_out'] },
  },
  required: [
    'performance_grade', 'pnl_assessment', 'strategy_breakdown',
    'pattern_identified', 'one_actionable_insight', 'topstep_status',
    'tomorrow_recommendation',
  ],
};

const SYSTEM_PROMPT = [
  'You are the performance analyst for STACKD TRADER.',
  "Each evening you analyze the day's trading activity and provide one actionable insight",
  "to improve tomorrow's performance.",
  'You are data-driven, specific, and direct.',
  'You never use em dashes.',
  'You focus on patterns not individual trades.',
].join(' ');

function safeFallback(input: EveningInput): EveningReport {
  const grade: EveningReport['performance_grade'] =
    input.final_pnl > 0 ? 'B' : input.final_pnl === 0 ? 'C' : 'D';
  return {
    performance_grade: grade,
    pnl_assessment: `Day P&L $${input.final_pnl.toFixed(2)}. Claude unavailable for analysis.`,
    strategy_breakdown: { momentum: 'inactive', mean_reversion: 'inactive', news_sentiment: 'inactive' },
    pattern_identified: 'No pattern available (Claude review failed).',
    one_actionable_insight: 'Re-run evening report once Claude is reachable.',
    topstep_status: input.topstep_compliance ? { on_track: !input.topstep_compliance.daily_loss_breach, notes: 'Auto-generated fallback.' } : null,
    tomorrow_recommendation: 'conservative',
  };
}

function tradeLine(t: Trade): string {
  return [
    `  ${t.instrument} ${t.strategy}/${t.status}`,
    `entry $${t.entry_price.toFixed(2)}`,
    t.exit_price !== null ? `exit $${t.exit_price.toFixed(2)}` : '',
    `pnl $${t.pnl.toFixed(2)}`,
  ].filter(Boolean).join(' | ');
}

export async function generateEveningReport(input: EveningInput): Promise<EveningReport> {
  return withTimeout(
    _generateEveningReportInner(input),
    HARD_BUDGET_MS,
    safeFallback(input),
    `evening_report:${input.mode}`,
  );
}

async function _generateEveningReportInner(input: EveningInput): Promise<EveningReport> {
  const trades = input.trades_today.slice(0, 30).map(tradeLine).join('\n') || '  (none)';

  const userMessage = [
    "Analyze today's trading performance and provide an evening report.",
    '',
    `Mode: ${input.mode}`,
    `Final P&L: $${input.final_pnl.toFixed(2)}`,
    `Win rate: ${(input.win_rate * 100).toFixed(1)}%`,
    `Total trades: ${input.trades_today.length}`,
    `Signals generated: ${input.signals_today_count}`,
    `Signals skipped: ${input.signals_skipped}`,
    `Regime changes today: ${input.regime_changes.length === 0 ? 'none' : input.regime_changes.join(', ')}`,
    '',
    'Trades:',
    trades,
    '',
    input.best_trade ? `Best: ${tradeLine(input.best_trade)}` : 'Best: (none)',
    input.worst_trade ? `Worst: ${tradeLine(input.worst_trade)}` : 'Worst: (none)',
    '',
    input.topstep_compliance
      ? `Topstep: daily_loss_breach=${input.topstep_compliance.daily_loss_breach}, drawdown_breach=${input.topstep_compliance.drawdown_breach}, profit_target_progress=${(input.topstep_compliance.profit_target_progress * 100).toFixed(1)}%`
      : 'Topstep: not applicable',
    '',
    'Return only this JSON, no other text:',
    '{',
    '  "performance_grade": "A" through "F",',
    '  "pnl_assessment": string max 100 chars,',
    '  "strategy_breakdown": {',
    '    "momentum": "working" or "struggling" or "inactive",',
    '    "mean_reversion": same, "news_sentiment": same',
    '  },',
    "  \"pattern_identified\": string max 150 characters describing a pattern in today's wins or losses,",
    '  "one_actionable_insight": string max 200 characters, specific and implementable tomorrow,',
    '  "topstep_status": object or null,',
    '  "tomorrow_recommendation": "normal" or "conservative" or "sit_out"',
    '}',
  ].join('\n');

  const result = await callClaude<EveningReport>({
    callType: 'evening_report',
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxTokens: 1000,
    schema: SCHEMA,
    fallback: safeFallback(input),
    logContext: {
      mode: input.mode,
      trade_count: input.trades_today.length,
      pnl: input.final_pnl,
    },
  });

  // Persist into daily_summaries — update existing row from the morning brief
  // if it exists, otherwise insert.
  try {
    const sb = supabaseService();
    const today = new Date().toISOString().slice(0, 10);
    const winners = input.trades_today.filter((t) => t.pnl > 0).length;
    const losers  = input.trades_today.filter((t) => t.pnl < 0).length;
    await sb.from('daily_summaries').upsert({
      mode: input.mode,
      date: today,
      total_trades: input.trades_today.length,
      winners,
      losers,
      gross_pnl: input.final_pnl,
      win_rate: input.win_rate * 100,
      compliance_passed: input.topstep_compliance ? !input.topstep_compliance.daily_loss_breach && !input.topstep_compliance.drawdown_breach : true,
      evening_report: result.parsed as unknown as Record<string, unknown>,
    }, { onConflict: 'mode,date' });
  } catch (err) {
    console.error('[evening] failed to persist report', err);
  }

  return result.parsed;
}

/** Helper used by the cron route — pull today's trades, signals, regime changes. */
export async function gatherDayDataFromSupabase(mode: TradeMode): Promise<EveningInput> {
  const sb = supabaseService();
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const startIso = start.toISOString();

  const tradesRes = await sb
    .from('trades')
    .select('*')
    .eq('mode', mode)
    .gte('entry_time', startIso);

  const signalsRes = await sb
    .from('signals')
    .select('id,action,created_at')
    .eq('mode', mode)
    .gte('created_at', startIso);

  const regimeRes = await sb
    .from('bot_event_log')
    .select('message,created_at')
    .eq('mode', mode)
    .eq('category', 'regime')
    .gte('created_at', startIso)
    .order('created_at', { ascending: true });

  const trades = tradesRes.data ?? [];
  const signals = signalsRes.data ?? [];
  const regimeMsgs = (regimeRes.data ?? []).map((r) => r.message);

  const closed = trades.filter((t) => t.status === 'closed');
  const winners = closed.filter((t) => t.pnl > 0);
  const losers  = closed.filter((t) => t.pnl < 0);
  const final_pnl = closed.reduce((sum, t) => sum + t.pnl, 0);
  const win_rate = closed.length === 0 ? 0 : winners.length / closed.length;
  const best  = closed.length === 0 ? null : closed.reduce((b, t) => (t.pnl > b.pnl ? t : b), closed[0]);
  const worst = closed.length === 0 ? null : closed.reduce((w, t) => (t.pnl < w.pnl ? t : w), closed[0]);

  return {
    mode,
    trades_today: trades,
    signals_today_count: signals.length,
    signals_skipped: signals.filter((s) => s.action === 'skip').length,
    regime_changes: regimeMsgs,
    final_pnl,
    win_rate,
    best_trade: best,
    worst_trade: worst,
    topstep_compliance: null,  // Day 4 wires Topstep numbers; placeholder until then.
  };
}

export type EveningStrategyKey = TradeStrategy;

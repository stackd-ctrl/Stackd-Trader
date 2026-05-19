// STACKD TRADER — Morning market brief.
//
// Runs at 9:00am ET on trading days via /api/cron/morning. Pulls account
// state, overnight price action, today's calendar, and asks Claude for a
// concise, actionable brief.

import 'server-only';
import { callClaude } from './client';
import { withTimeout } from './timeout';
import { supabaseService } from '@/lib/supabase';

const HARD_BUDGET_MS = 3_000;
import type {
  CalendarEvent,
  MarketRegime,
  TradeMode,
} from '@/types/database';

export interface OvernightChange {
  instrument: string;
  open_yesterday: number;
  current_price: number;
  change_pct: number;
}

export interface AccountStatus {
  balance: number;
  daily_pnl_yesterday: number;
  win_rate_7day: number;
}

export interface TopstepStatus {
  daily_loss_remaining: number;
  drawdown_remaining: number;
  profit_target_progress: number;
}

export interface MorningBriefInput {
  mode: TradeMode;
  overnight_price_changes: OvernightChange[];
  premarket_volume: number;
  economic_events_today: CalendarEvent[];
  recent_news_summary: string[];
  current_regime: MarketRegime;
  account_status: AccountStatus;
  topstep_status: TopstepStatus | null;
}

export interface InstrumentWatch {
  instrument: string;
  reason: string;
}

export interface MorningBrief {
  date: string;
  overall_conditions: 'favorable' | 'caution' | 'avoid';
  regime_assessment: string;             // max 100
  key_risks_today: string[];             // max 3 strings, each max 80
  instruments_to_watch: InstrumentWatch[]; // max 3
  economic_events_warning: string | null;
  topstep_guidance: string | null;
  bot_recommendation: 'full_activity' | 'reduced_activity' | 'sit_out';
  one_sentence_summary: string;          // max 150
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    date:               { type: 'string' },
    overall_conditions: { type: 'string', enum: ['favorable', 'caution', 'avoid'] },
    regime_assessment:  { type: 'string', maxLength: 100 },
    key_risks_today: {
      type: 'array',
      items: { type: 'string', maxLength: 80 },
      maxItems: 3,
    },
    instruments_to_watch: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          instrument: { type: 'string' },
          reason:     { type: 'string' },
        },
        required: ['instrument', 'reason'],
      },
      maxItems: 3,
    },
    economic_events_warning: { type: ['string', 'null'] },
    topstep_guidance:        { type: ['string', 'null'] },
    bot_recommendation:      { type: 'string', enum: ['full_activity', 'reduced_activity', 'sit_out'] },
    one_sentence_summary:    { type: 'string', maxLength: 150 },
  },
  required: [
    'date', 'overall_conditions', 'regime_assessment', 'key_risks_today',
    'instruments_to_watch', 'economic_events_warning', 'topstep_guidance',
    'bot_recommendation', 'one_sentence_summary',
  ],
};

const SYSTEM_PROMPT = [
  'You are the morning analyst for STACKD TRADER, an algorithmic trading system.',
  'Every morning before market open you provide a concise, actionable market brief.',
  'You are direct and data-focused. You highlight risks clearly.',
  'You never use em dashes.',
  "You never use filler phrases like 'it is worth noting' or 'it is important to remember'.",
].join(' ');

function buildSafeFallback(input: MorningBriefInput): MorningBrief {
  return {
    date: new Date().toISOString().slice(0, 10),
    overall_conditions: 'caution',
    regime_assessment: `${input.current_regime} regime detected.`,
    key_risks_today: ['Claude unavailable for morning brief.'],
    instruments_to_watch: [],
    economic_events_warning: input.economic_events_today.length > 0
      ? `${input.economic_events_today.length} high-impact event(s) today.`
      : null,
    topstep_guidance: input.topstep_status ? 'Stay within Topstep daily limits.' : null,
    bot_recommendation: 'reduced_activity',
    one_sentence_summary: 'Brief generation failed. Manual review recommended before activating bot.',
  };
}

export async function generateMorningBrief(input: MorningBriefInput): Promise<MorningBrief> {
  return withTimeout(
    _generateMorningBriefInner(input),
    HARD_BUDGET_MS,
    buildSafeFallback(input),
    `morning_brief:${input.mode}`,
  );
}

async function _generateMorningBriefInner(input: MorningBriefInput): Promise<MorningBrief> {
  const overnight = input.overnight_price_changes
    .map((c) => `  ${c.instrument}: $${c.current_price.toFixed(2)} (${c.change_pct >= 0 ? '+' : ''}${c.change_pct.toFixed(2)}%)`)
    .join('\n') || '  (none)';

  const events = input.economic_events_today
    .map((e) => `  ${new Date(e.scheduled_at).toISOString().slice(11, 16)} ET: ${e.event}${e.country ? ` (${e.country})` : ''}`)
    .join('\n') || '  (none)';

  const news = input.recent_news_summary.slice(0, 5).map((n, i) => `  ${i + 1}. ${n}`).join('\n') || '  (none)';

  const topstep = input.topstep_status
    ? [
        'Topstep status:',
        `  Daily loss remaining: $${input.topstep_status.daily_loss_remaining.toFixed(2)}`,
        `  Drawdown remaining: $${input.topstep_status.drawdown_remaining.toFixed(2)}`,
        `  Profit target progress: ${(input.topstep_status.profit_target_progress * 100).toFixed(1)}%`,
      ].join('\n')
    : 'Topstep status: not applicable (mode is not topstep)';

  const userMessage = [
    'Generate a morning trading brief for today based on this market data:',
    '',
    `Mode: ${input.mode}`,
    `Current regime: ${input.current_regime}`,
    '',
    'Overnight price changes:',
    overnight,
    '',
    `Premarket volume: ${input.premarket_volume.toLocaleString('en-US')}`,
    '',
    'Economic events today:',
    events,
    '',
    'Recent news themes:',
    news,
    '',
    'Account status:',
    `  Balance: $${input.account_status.balance.toFixed(2)}`,
    `  P&L yesterday: $${input.account_status.daily_pnl_yesterday.toFixed(2)}`,
    `  7-day win rate: ${(input.account_status.win_rate_7day * 100).toFixed(1)}%`,
    '',
    topstep,
    '',
    'Return only this JSON, no other text:',
    '{',
    '  "date": string,',
    '  "overall_conditions": "favorable" or "caution" or "avoid",',
    '  "regime_assessment": string max 100 characters,',
    '  "key_risks_today": array of max 3 strings each max 80 characters,',
    '  "instruments_to_watch": array of max 3 objects with instrument and reason,',
    '  "economic_events_warning": string or null if no major events,',
    '  "topstep_guidance": string or null (only if in Topstep mode),',
    '  "bot_recommendation": "full_activity" or "reduced_activity" or "sit_out",',
    '  "one_sentence_summary": string max 150 characters',
    '}',
  ].join('\n');

  const result = await callClaude<MorningBrief>({
    callType: 'morning_brief',
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxTokens: 1000,
    schema: SCHEMA,
    fallback: buildSafeFallback(input),
    logContext: { mode: input.mode, regime: input.current_regime },
  });

  // Persist into daily_summaries (upsert on mode+date).
  try {
    const sb = supabaseService();
    const today = new Date().toISOString().slice(0, 10);
    await sb.from('daily_summaries').upsert({
      mode: input.mode,
      date: today,
      morning_brief: result.parsed as unknown as Record<string, unknown>,
    }, { onConflict: 'mode,date' });
  } catch (err) {
    console.error('[morning] failed to persist brief', err);
  }

  return result.parsed;
}

// STACKD TRADER — Regime classification with macro context.
//
// Layers Claude on top of the pure technical classifier in lib/regime/detector.ts.
// Returns the regime + a strategy allocation + a position-size multiplier.
// Persists the regime to bot_status; the multiplier/allocation are surfaced
// to the order sizer (Day 4).

import 'server-only';
import { callClaude } from './client';
import { withTimeout } from './timeout';
import { supabaseService } from '@/lib/supabase';
import { classifyRegime } from '@/lib/regime/detector';

const HARD_BUDGET_MS = 3_000;
import type { CalendarEvent, MarketRegime, TradeMode } from '@/types/database';

export interface RegimeIntelInput {
  mode: TradeMode;
  adx: number;
  atr: number;
  atr_20day_avg: number;
  recent_price_action: string;
  todays_news_themes: string[];
  economic_events_today: CalendarEvent[];
  vix_equivalent: number | null;
}

export interface RegimeIntel {
  regime: MarketRegime;
  confidence: number;          // 0..1
  reasoning: string;           // max 150
  strategy_allocation: {
    momentum_pct: number;
    mean_reversion_pct: number;
    news_sentiment_pct: number;
  };
  position_size_multiplier: number;  // 0..1
  review_in_minutes: number;          // when to re-classify
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    regime:     { type: 'string', enum: ['trending', 'ranging', 'high_volatility', 'extreme_volatility', 'low_volatility'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasoning:  { type: 'string', maxLength: 150 },
    strategy_allocation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        momentum_pct:        { type: 'number', minimum: 0, maximum: 100 },
        mean_reversion_pct:  { type: 'number', minimum: 0, maximum: 100 },
        news_sentiment_pct:  { type: 'number', minimum: 0, maximum: 100 },
      },
      required: ['momentum_pct', 'mean_reversion_pct', 'news_sentiment_pct'],
    },
    position_size_multiplier: { type: 'number', minimum: 0, maximum: 1 },
    review_in_minutes:        { type: 'number', minimum: 5, maximum: 240 },
  },
  required: ['regime', 'confidence', 'reasoning', 'strategy_allocation', 'position_size_multiplier', 'review_in_minutes'],
};

const SYSTEM_PROMPT = [
  'You are the market regime classifier for STACKD TRADER.',
  'You combine technical indicators with macro context to classify current market conditions.',
  'Your classification directly controls which trading strategies are active.',
  'Be conservative. When uncertain classify as higher volatility.',
  'You never use em dashes.',
].join(' ');

function technicalFallback(input: RegimeIntelInput): RegimeIntel {
  const tech = classifyRegime({
    adx: input.adx,
    atr: input.atr,
    atr20DayAvg: input.atr_20day_avg,
    newsEventActive: input.economic_events_today.length > 0,
  });
  // Conservative defaults if Claude is down.
  return {
    regime: tech.regime,
    confidence: tech.confidence,
    reasoning: tech.reasoning.slice(0, 150),
    strategy_allocation: { momentum_pct: 33, mean_reversion_pct: 34, news_sentiment_pct: 33 },
    position_size_multiplier: 0.5,
    review_in_minutes: 30,
  };
}

export async function classifyRegimeWithContext(input: RegimeIntelInput): Promise<RegimeIntel> {
  return withTimeout(
    _classifyRegimeWithContextInner(input),
    HARD_BUDGET_MS,
    technicalFallback(input),
    `regime:${input.mode}`,
  );
}

async function _classifyRegimeWithContextInner(input: RegimeIntelInput): Promise<RegimeIntel> {
  const events = input.economic_events_today
    .map((e) => `  ${new Date(e.scheduled_at).toISOString().slice(11, 16)} ET: ${e.event}`).join('\n') || '  (none)';
  const themes = input.todays_news_themes.length === 0 ? '(none)' : input.todays_news_themes.slice(0, 5).join('; ');

  const userMessage = [
    'Classify the current market regime using technical indicators and macro context.',
    '',
    'Technical indicators:',
    `  ADX (14): ${input.adx.toFixed(2)}`,
    `  ATR today: ${input.atr.toFixed(4)}`,
    `  ATR 20-day average: ${input.atr_20day_avg.toFixed(4)}`,
    `  ATR ratio: ${(input.atr_20day_avg > 0 ? (input.atr / input.atr_20day_avg) : 1).toFixed(2)}x`,
    `  VIX equivalent: ${input.vix_equivalent === null ? '(unavailable)' : input.vix_equivalent.toFixed(2)}`,
    '',
    'Recent price action:',
    `  ${input.recent_price_action}`,
    '',
    `News themes today: ${themes}`,
    '',
    'Economic events today:',
    events,
    '',
    'Return only this JSON, no other text:',
    '{',
    '  "regime": one of the five regime enums (trending, ranging, high_volatility, extreme_volatility, low_volatility),',
    '  "confidence": number 0-1,',
    '  "reasoning": string max 150 characters,',
    '  "strategy_allocation": {',
    '    "momentum_pct": number, "mean_reversion_pct": number, "news_sentiment_pct": number',
    '  },',
    '  "position_size_multiplier": number between 0 and 1,',
    '  "review_in_minutes": number (how long until next classification needed)',
    '}',
  ].join('\n');

  const result = await callClaude<RegimeIntel>({
    callType: 'regime_classify',
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxTokens: 1000,
    schema: SCHEMA,
    fallback: technicalFallback(input),
    logContext: { mode: input.mode, adx: input.adx, atr: input.atr },
  });

  // Persist regime + log change.
  try {
    const sb = supabaseService();
    const { data: current } = await sb
      .from('bot_status')
      .select('regime')
      .eq('mode', input.mode)
      .single();
    const previous = current?.regime ?? null;
    await sb.from('bot_status').update({ regime: result.parsed.regime }).eq('mode', input.mode);
    if (previous !== result.parsed.regime) {
      await sb.from('bot_event_log').insert({
        mode: input.mode,
        level: 'info',
        category: 'regime',
        message: `Regime changed (Claude): ${previous ?? 'unknown'} → ${result.parsed.regime}`,
        context: result.parsed as unknown as Record<string, unknown>,
      });
    }
  } catch (err) {
    console.error('[regime] failed to persist Claude regime', err);
  }

  return result.parsed;
}

// STACKD TRADER — Final signal explanation + action via Claude.
//
// Called after the technical scorer in lib/signals/generator.ts clears the
// 58.5 raw threshold. Adds sentiment-aware final score, plain-English
// explanation, and a sizing recommendation. Persists back to the signals row.

import 'server-only';
import { callClaude } from './client';
import { withTimeout } from './timeout';
import { supabaseService } from '@/lib/supabase';

const HARD_BUDGET_MS = 3_000;
import { ENTER_THRESHOLD, SIGNAL_WEIGHTS } from '@/lib/constants';
import type {
  MarketRegime,
  SignalAction,
  TradeDirection,
  TradeStrategy,
} from '@/types/database';

export interface SignalExplainInput {
  signal_id: string;        // signals.id we will update
  instrument: string;
  strategy: TradeStrategy;
  direction: TradeDirection;
  rsi: number;
  rsi_score: number;
  macd_histogram: number;
  macd_score: number;
  volume_ratio: number;
  volume_score: number;
  key_level_break: boolean;
  key_level_score: number;
  atr: number;
  atr_score: number;
  regime: MarketRegime;
  regime_score: number;
  sentiment_score_0to10: number;     // sentiment converted to 0..10 for weighting
  sentiment_raw: number;             // -10..10 raw
  raw_score: number;                 // 0..90 pre-sentiment
  entry_price: number;
  stop_loss: number;
  take_profit: number;
}

export interface SignalExplainResult {
  action: SignalAction;
  final_score: number;
  confidence: 'high' | 'medium' | 'low';
  explanation: string;          // max 120 chars
  key_strength: string;          // max 60 chars
  key_risk: string;              // max 60 chars
  sizing_recommendation: 'full' | 'half' | 'skip';
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action:        { type: 'string', enum: ['enter', 'skip'] },
    final_score:   { type: 'number', minimum: 0, maximum: 100 },
    confidence:    { type: 'string', enum: ['high', 'medium', 'low'] },
    explanation:   { type: 'string', maxLength: 120 },
    key_strength:  { type: 'string', maxLength: 60 },
    key_risk:      { type: 'string', maxLength: 60 },
    sizing_recommendation: { type: 'string', enum: ['full', 'half', 'skip'] },
  },
  required: ['action', 'final_score', 'confidence', 'explanation', 'key_strength', 'key_risk', 'sizing_recommendation'],
};

const SYSTEM_PROMPT = [
  'You are the AI brain of STACKD TRADER, an algorithmic trading system.',
  'Your job is to analyze trading signals and provide clear, concise explanations',
  'for why a trade should be entered or skipped.',
  'You are direct, precise, and never use financial jargon without explanation.',
  'You never use em dashes.',
  'You respond only in the exact JSON format requested.',
].join(' ');

function rrRatio(entry: number, stop: number, target: number, direction: TradeDirection): number {
  if (direction === 'long') {
    const risk = entry - stop;
    const reward = target - entry;
    if (risk <= 0) return 0;
    return reward / risk;
  }
  const risk = stop - entry;
  const reward = entry - target;
  if (risk <= 0) return 0;
  return reward / risk;
}

function safeFallback(input: SignalExplainInput): SignalExplainResult {
  // If Claude is down: trust the technical score, no enter without sentiment confirmation.
  // Compute what the final would be assuming sentiment is neutral (0/10).
  const finalTechOnly =
    input.raw_score + 0 * (SIGNAL_WEIGHTS.sentiment / 10);
  return {
    action: 'skip',  // safe default — never enter if Claude couldn't review
    final_score: finalTechOnly,
    confidence: 'low',
    explanation: 'Claude review unavailable. Skipped per safety policy.',
    key_strength: 'Technical raw score cleared 58.5 gate',
    key_risk: 'No AI verification of news or context',
    sizing_recommendation: 'skip',
  };
}

export async function explainSignal(input: SignalExplainInput): Promise<SignalExplainResult> {
  return withTimeout(
    _explainSignalInner(input),
    HARD_BUDGET_MS,
    safeFallback(input),
    `signal:${input.instrument}`,
  );
}

async function _explainSignalInner(input: SignalExplainInput): Promise<SignalExplainResult> {
  const rr = rrRatio(input.entry_price, input.stop_loss, input.take_profit, input.direction);

  const factorLines = [
    `- Instrument: ${input.instrument}`,
    `- Strategy: ${input.strategy}`,
    `- Direction: ${input.direction}`,
    `- RSI: ${input.rsi.toFixed(2)} (score: ${input.rsi_score}/10)`,
    `- MACD Histogram: ${input.macd_histogram.toFixed(4)} (score: ${input.macd_score}/10)`,
    `- Volume Ratio: ${input.volume_ratio.toFixed(2)} (score: ${input.volume_score}/10)`,
    `- Key Level Break: ${input.key_level_break ? 'true' : 'false'} (score: ${input.key_level_score}/10)`,
    `- ATR: ${input.atr.toFixed(4)} (score: ${input.atr_score}/10)`,
    `- Regime: ${input.regime} (score: ${input.regime_score}/10)`,
    `- Sentiment Score: ${input.sentiment_raw.toFixed(2)} (score: ${input.sentiment_score_0to10}/10)`,
    `- Total Weighted Score: ${input.raw_score.toFixed(1)}/100`,
    `- Proposed Entry: $${input.entry_price.toFixed(2)}`,
    `- Proposed Stop Loss: $${input.stop_loss.toFixed(2)}`,
    `- Proposed Take Profit: $${input.take_profit.toFixed(2)}`,
    `- Reward to Risk: ${rr.toFixed(2)}`,
  ].join('\n');

  const userMessage = [
    'Analyze this trading signal and provide a final recommendation.',
    '',
    'Signal data:',
    factorLines,
    '',
    'Return only this JSON, no other text:',
    '{',
    '  "action": "enter" or "skip",',
    '  "final_score": number 0-100,',
    '  "confidence": "high" or "medium" or "low",',
    '  "explanation": string max 120 characters explaining the decision in plain English,',
    '  "key_strength": string max 60 characters describing the strongest factor,',
    '  "key_risk": string max 60 characters describing the biggest risk,',
    '  "sizing_recommendation": "full" or "half" or "skip" based on confidence',
    '}',
  ].join('\n');

  const result = await callClaude<SignalExplainResult>({
    callType: 'signal_explain',
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxTokens: 1000,
    schema: SCHEMA,
    fallback: safeFallback(input),
    logContext: { signal_id: input.signal_id, instrument: input.instrument },
  });

  // Hard policy: even if Claude says enter, require final_score >= ENTER_THRESHOLD
  // AND reward/risk above 1.6. Otherwise force skip.
  const passesGate = result.parsed.final_score >= ENTER_THRESHOLD && rr >= 1.6;
  const finalAction: SignalAction = passesGate ? result.parsed.action : 'skip';

  const out: SignalExplainResult = {
    ...result.parsed,
    action: finalAction,
    sizing_recommendation: finalAction === 'enter' ? result.parsed.sizing_recommendation : 'skip',
  };

  // Persist back to the signals row.
  try {
    const sb = supabaseService();
    await sb
      .from('signals')
      .update({
        action: out.action,
        total_score: out.final_score,
        sentiment_score: input.sentiment_raw,
        claude_explanation: `${out.explanation} | Strength: ${out.key_strength} | Risk: ${out.key_risk}`,
      })
      .eq('id', input.signal_id);
  } catch (err) {
    console.error('[signals] failed to persist explanation', err);
  }

  return out;
}

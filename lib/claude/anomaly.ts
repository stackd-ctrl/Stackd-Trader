// STACKD TRADER — Anomaly detection.
//
// Runs every 15 min during market hours. If severity is critical or the
// recommended action is pause_bot/close_positions, the bot is auto-stopped
// in Supabase and an alert is created.

import 'server-only';
import { callClaude } from './client';
import { withTimeout } from './timeout';
import { supabaseService } from '@/lib/supabase';

const HARD_BUDGET_MS = 3_000;
import type {
  AnomalyAction,
  AnomalySeverity,
  MarketRegime,
  TradeMode,
} from '@/types/database';

export interface AnomalySnapshot {
  mode: TradeMode;
  current_prices: Record<string, number>;
  price_changes_15min: Record<string, number>;     // percent
  volume_spikes: Record<string, number>;            // multiplier vs avg
  correlation_matrix: Record<string, Record<string, number>>;
  regime: MarketRegime;
  recent_signal_scores: number[];
  open_position_count: number;
}

export interface AnomalyResult {
  anomaly_detected: boolean;
  severity: AnomalySeverity;
  anomaly_type: string | null;
  description: string | null;
  recommended_action: AnomalyAction;
  affects_instruments: string[];
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    anomaly_detected: { type: 'boolean' },
    severity:         { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    anomaly_type:     { type: ['string', 'null'] },
    description:      { type: ['string', 'null'], maxLength: 150 },
    recommended_action: { type: 'string', enum: ['continue', 'reduce_exposure', 'pause_bot', 'close_positions'] },
    affects_instruments: { type: 'array', items: { type: 'string' } },
  },
  required: ['anomaly_detected', 'severity', 'anomaly_type', 'description', 'recommended_action', 'affects_instruments'],
};

const SYSTEM_PROMPT = [
  'You are the risk monitor for STACKD TRADER.',
  'Your job is to detect unusual market conditions that could harm open positions',
  'or indicate the strategy should pause.',
  'You are conservative and prioritize capital protection.',
  'You never use em dashes.',
].join(' ');

const SAFE_FALLBACK: AnomalyResult = {
  anomaly_detected: false,
  severity: 'low',
  anomaly_type: null,
  description: null,
  recommended_action: 'continue',
  affects_instruments: [],
};

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export async function detectAnomalies(snap: AnomalySnapshot): Promise<AnomalyResult> {
  return withTimeout(
    _detectAnomaliesInner(snap),
    HARD_BUDGET_MS,
    SAFE_FALLBACK,
    `anomaly:${snap.mode}`,
  );
}

async function _detectAnomaliesInner(snap: AnomalySnapshot): Promise<AnomalyResult> {
  const prices = Object.entries(snap.current_prices)
    .map(([k, v]) => `  ${k}: $${v.toFixed(2)} (${pct(snap.price_changes_15min[k] ?? 0)} 15min)`).join('\n')
    || '  (no prices)';
  const vol = Object.entries(snap.volume_spikes)
    .map(([k, v]) => `  ${k}: ${v.toFixed(2)}x avg`).join('\n') || '  (none)';

  const corrLines: string[] = [];
  for (const [a, row] of Object.entries(snap.correlation_matrix)) {
    for (const [b, c] of Object.entries(row)) {
      if (a < b) corrLines.push(`  ${a}/${b}: ${c.toFixed(2)}`);
    }
  }
  const corr = corrLines.length > 0 ? corrLines.join('\n') : '  (insufficient data)';

  const userMessage = [
    'Analyze this market snapshot for anomalies that warrant attention.',
    '',
    `Mode: ${snap.mode}`,
    `Regime: ${snap.regime}`,
    `Open positions: ${snap.open_position_count}`,
    `Recent signal scores: ${snap.recent_signal_scores.map((n) => n.toFixed(1)).join(', ') || '(none)'}`,
    '',
    'Current prices and 15-minute changes:',
    prices,
    '',
    'Volume spikes:',
    vol,
    '',
    'Cross-instrument correlations:',
    corr,
    '',
    'Return only this JSON, no other text:',
    '{',
    '  "anomaly_detected": boolean,',
    '  "severity": "low" or "medium" or "high" or "critical",',
    '  "anomaly_type": string or null,',
    '  "description": string max 150 chars or null,',
    '  "recommended_action": "continue" or "reduce_exposure" or "pause_bot" or "close_positions",',
    '  "affects_instruments": array of instrument strings or empty array',
    '}',
  ].join('\n');

  const result = await callClaude<AnomalyResult>({
    callType: 'anomaly_check',
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxTokens: 500,
    schema: SCHEMA,
    fallback: SAFE_FALLBACK,
    logContext: { mode: snap.mode, regime: snap.regime, open_positions: snap.open_position_count },
  });

  if (result.parsed.anomaly_detected) {
    await onAnomaly(snap.mode, result.parsed);
  }
  return result.parsed;
}

async function onAnomaly(mode: TradeMode, r: AnomalyResult): Promise<void> {
  const sb = supabaseService();

  // Always persist any detected anomaly so it shows up in the dashboard.
  await sb.from('anomalies').insert({
    mode,
    severity: r.severity,
    anomaly_type: r.anomaly_type,
    description: r.description,
    recommended_action: r.recommended_action,
    affects_instruments: r.affects_instruments,
  });

  const isCritical = r.severity === 'critical'
    || r.recommended_action === 'pause_bot'
    || r.recommended_action === 'close_positions';

  if (!isCritical) return;

  // Auto-stop the bot.
  await sb.from('bot_status').update({ is_active: false }).eq('mode', mode);

  // Audit log.
  await sb.from('bot_event_log').insert({
    mode,
    level: 'error',
    category: 'system',
    message: `Bot auto-stopped: ${r.anomaly_type ?? 'critical anomaly'}`,
    context: r as unknown as Record<string, unknown>,
  });
}

// STACKD TRADER — Signal generator.
//
// The "core brain before Claude": pull current data, score each factor 0..10,
// apply weights, persist the row. Anything that clears RAW_THRESHOLD is
// handed to Claude later for sentiment + the final explanation.

import 'server-only';
import { supabaseService } from '@/lib/supabase';
import { ADX, ATR, MACD, RSI, VOLUME_RATIO, detectKeyLevelBreak } from '@/lib/indicators';
import { getCandles, type Candle } from '@/lib/polygon/client';
import { instrumentsForMode, type InstrumentConfig } from '@/lib/instruments';
import { isBlackoutPeriod } from '@/lib/calendar/events';
import { isCryptoSession, isMarketHours } from '@/lib/time';
import { ENTER_THRESHOLD, NON_SENTIMENT_MAX, RAW_THRESHOLD, SIGNAL_WEIGHTS } from '@/lib/constants';
import type {
  MarketRegime,
  Signal,
  TradeDirection,
  TradeMode,
  TradeStrategy,
} from '@/types/database';

export interface FactorScores {
  rsi: number;          // 0..10
  macd: number;
  volume: number;
  keyLevel: number;
  atr: number;
  regime: number;
  // sentiment intentionally omitted here — added by Claude later
}

export interface RawSignal {
  instrument: string;
  strategy: TradeStrategy;
  direction: TradeDirection;
  rsi: number;
  macd_histogram: number;
  volume_ratio: number;
  key_level_break: boolean;
  atr: number;
  regime: MarketRegime;
  raw_score: number;        // 0..NON_SENTIMENT_MAX
  factor_scores: FactorScores;
  timestamp: string;
}

export type PreconditionFailure =
  | 'market_closed'
  | 'blackout'
  | 'bot_inactive'
  | 'daily_loss_limit'
  | 'no_data';

export interface GeneratorResult {
  generated: RawSignal[];
  skipped: Array<{ instrument: string; reason: PreconditionFailure | 'low_raw_score'; raw_score?: number }>;
}

// ---- Factor scoring (each returns 0..10) -----------------------------------

function scoreRSI(rsi: number, direction: TradeDirection): number {
  // Long sweet spot: 50..65 (momentum entering, not exhausted)
  // Short sweet spot: 35..50
  if (direction === 'long') {
    if (rsi >= 50 && rsi <= 65) return 10;
    if (rsi > 65 && rsi <= 75) return 6;
    if (rsi > 75) return 1;       // exhausted
    if (rsi >= 40 && rsi < 50) return 5;
    return 2;
  }
  // short
  if (rsi >= 35 && rsi <= 50) return 10;
  if (rsi >= 25 && rsi < 35) return 6;
  if (rsi < 25) return 1;
  if (rsi > 50 && rsi <= 60) return 5;
  return 2;
}

function scoreMACDHistogram(hist: number, prevHist: number, direction: TradeDirection): number {
  const turning = direction === 'long' ? hist > prevHist : hist < prevHist;
  const inDir   = direction === 'long' ? hist > 0       : hist < 0;
  if (inDir && turning) return 10;
  if (inDir) return 7;
  if (turning) return 5;
  return 1;
}

function scoreVolume(ratio: number): number {
  if (ratio >= 1.5) return 10;
  if (ratio >= 1.2) return 8;
  if (ratio >= 1.0) return 5;
  if (ratio >= 0.8) return 3;
  return 0;
}

function scoreKeyLevel(broke: boolean): number {
  return broke ? 10 : 3;
}

function scoreATR(atrToday: number, atr20d: number): number {
  if (atr20d <= 0) return 5;
  const ratio = atrToday / atr20d;
  if (ratio >= 0.9 && ratio <= 1.4) return 10;  // normal range
  if (ratio > 1.4 && ratio <= 1.8) return 6;
  if (ratio > 1.8) return 1;                    // too volatile
  if (ratio >= 0.6) return 6;
  return 1;                                     // too quiet
}

function scoreRegime(regime: MarketRegime, strategy: TradeStrategy): number {
  // Match each strategy to the regimes it shines in.
  switch (strategy) {
    case 'momentum':
      if (regime === 'trending') return 10;
      if (regime === 'high_volatility') return 7;
      if (regime === 'ranging') return 3;
      return 1;
    case 'mean_reversion':
      if (regime === 'ranging') return 10;
      if (regime === 'low_volatility') return 7;
      if (regime === 'trending') return 2;
      return 1;
    case 'news_sentiment':
      if (regime === 'high_volatility' || regime === 'extreme_volatility') return 9;
      return 5;
  }
}

// ---- Weight application ----------------------------------------------------

export function weightedRawScore(scores: FactorScores): number {
  return (
    scores.rsi      * (SIGNAL_WEIGHTS.rsi      / 10) +
    scores.macd     * (SIGNAL_WEIGHTS.macd     / 10) +
    scores.volume   * (SIGNAL_WEIGHTS.volume   / 10) +
    scores.keyLevel * (SIGNAL_WEIGHTS.keyLevel / 10) +
    scores.atr      * (SIGNAL_WEIGHTS.atr      / 10) +
    scores.regime   * (SIGNAL_WEIGHTS.regime   / 10)
  );
}

// ---- Strategy + direction picker -------------------------------------------

function pickDirection(closes: number[], rsi: number, histogram: number): TradeDirection {
  // Simple bias: above midline RSI + positive histogram = long; flip for short.
  const last = closes[closes.length - 1];
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, closes.length);
  const trendBias = last >= sma20 ? 1 : -1;
  const macdBias = histogram >= 0 ? 1 : -1;
  const rsiBias = rsi >= 50 ? 1 : -1;
  const sum = trendBias + macdBias + rsiBias;
  return sum >= 0 ? 'long' : 'short';
}

function pickStrategy(regime: MarketRegime, broke: boolean): TradeStrategy {
  if (broke) return 'momentum';
  if (regime === 'trending' || regime === 'high_volatility') return 'momentum';
  if (regime === 'ranging' || regime === 'low_volatility') return 'mean_reversion';
  return 'news_sentiment';
}

// ---- Per-instrument scoring -----------------------------------------------

interface ScoreOpts {
  regime: MarketRegime;
  atr20d: number;
}

function scoreInstrument(
  instrument: string,
  candles: Candle[],
  opts: ScoreOpts,
): RawSignal | null {
  if (candles.length < 30) return null;

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const rsi = RSI(closes, 14);
  const macd = MACD(closes);
  const macdPrev = MACD(closes.slice(0, -1));
  const volRatio = VOLUME_RATIO(volumes, 20);
  const broke = detectKeyLevelBreak(candles);
  const atrToday = ATR(candles, 14);

  const direction = pickDirection(closes, rsi, macd.histogram);
  const strategy = pickStrategy(opts.regime, broke);

  const factors: FactorScores = {
    rsi:      scoreRSI(rsi, direction),
    macd:     scoreMACDHistogram(macd.histogram, macdPrev.histogram, direction),
    volume:   scoreVolume(volRatio),
    keyLevel: scoreKeyLevel(broke),
    atr:      scoreATR(atrToday, opts.atr20d),
    regime:   scoreRegime(opts.regime, strategy),
  };

  const raw = weightedRawScore(factors);

  return {
    instrument,
    strategy,
    direction,
    rsi,
    macd_histogram: macd.histogram,
    volume_ratio: volRatio,
    key_level_break: broke,
    atr: atrToday,
    regime: opts.regime,
    raw_score: raw,
    factor_scores: factors,
    timestamp: new Date().toISOString(),
  };
}

// ---- Preconditions ---------------------------------------------------------

interface Preconditions {
  ok: boolean;
  reason?: PreconditionFailure;
}

async function checkPreconditions(mode: TradeMode, inst: InstrumentConfig): Promise<Preconditions> {
  // 1. Market hours — crypto trades 24/7, futures/equities only during session.
  if (inst.class !== 'crypto' && !isMarketHours()) return { ok: false, reason: 'market_closed' };
  if (inst.class === 'crypto' && !isCryptoSession()) return { ok: false, reason: 'market_closed' };

  // 2. Bot active + loss limits.
  const sb = supabaseService();
  const { data, error } = await sb
    .from('bot_status')
    .select('is_active, daily_loss_limit_hit')
    .eq('mode', mode)
    .single();
  if (error || !data) return { ok: false, reason: 'no_data' };
  if (!data.is_active) return { ok: false, reason: 'bot_inactive' };
  if (data.daily_loss_limit_hit) return { ok: false, reason: 'daily_loss_limit' };

  // 3. Economic calendar blackout.
  if (await isBlackoutPeriod()) return { ok: false, reason: 'blackout' };

  return { ok: true };
}

// ---- Public entrypoint -----------------------------------------------------

/**
 * Run a full signal scan for one mode. Generates per instrument, persists
 * anything that clears RAW_THRESHOLD with action='enter' if it also clears
 * ENTER_THRESHOLD (after assuming neutral sentiment for the row), otherwise
 * 'skip'. Sentiment + final score will be patched in by the Claude pass.
 */
export async function runSignalScan(mode: TradeMode): Promise<GeneratorResult> {
  const sb = supabaseService();
  const result: GeneratorResult = { generated: [], skipped: [] };

  // Pull bot regime once per scan.
  const { data: status } = await sb
    .from('bot_status')
    .select('regime')
    .eq('mode', mode)
    .single();
  const regime: MarketRegime = status?.regime ?? 'ranging';

  for (const inst of instrumentsForMode(mode)) {
    const pre = await checkPreconditions(mode, inst);
    if (!pre.ok) {
      result.skipped.push({ instrument: inst.key, reason: pre.reason! });
      continue;
    }

    let candles: Candle[];
    try {
      candles = await getCandles(inst.key, '5m', 100);
    } catch (err) {
      console.error(`[signal] getCandles failed for ${inst.key}`, err);
      result.skipped.push({ instrument: inst.key, reason: 'no_data' });
      continue;
    }

    const daily = await getCandles(inst.key, '1d', 30).catch(() => []);
    const atr20d = daily.length >= 21 ? ATR(daily.slice(-21), 20) : 0;

    const raw = scoreInstrument(inst.key, candles, { regime, atr20d });
    if (!raw) {
      result.skipped.push({ instrument: inst.key, reason: 'no_data' });
      continue;
    }

    // Gate: skip Claude (and persistence) if raw < RAW_THRESHOLD.
    if (raw.raw_score < RAW_THRESHOLD) {
      result.skipped.push({
        instrument: inst.key,
        reason: 'low_raw_score',
        raw_score: raw.raw_score,
      });
      continue;
    }

    // Persist row. Sentiment stays null until Claude runs.
    const totalAssumingNeutralSentiment = raw.raw_score; // sentiment factor = 0 until Claude
    const action = totalAssumingNeutralSentiment >= ENTER_THRESHOLD ? 'enter' : 'skip';

    const row: Omit<Signal, 'id' | 'created_at'> = {
      mode,
      instrument: raw.instrument,
      strategy: raw.strategy,
      direction: raw.direction,
      rsi: raw.rsi,
      macd: raw.macd_histogram,
      macd_histogram: raw.macd_histogram,
      volume_ratio: raw.volume_ratio,
      key_level_break: raw.key_level_break,
      atr: raw.atr,
      regime: raw.regime,
      raw_score: raw.raw_score,
      sentiment_score: null,
      total_score: totalAssumingNeutralSentiment,
      action,
      claude_explanation: null,
    };

    const { error } = await sb.from('signals').insert(row);
    if (error) {
      console.error(`[signal] insert failed for ${inst.key}`, error);
      result.skipped.push({ instrument: inst.key, reason: 'no_data' });
      continue;
    }

    result.generated.push(raw);
  }

  return result;
}

// ---- Re-exports for the API layer ------------------------------------------

export { NON_SENTIMENT_MAX, RAW_THRESHOLD, ENTER_THRESHOLD };

// STACKD TRADER — Regime detector.
//
// Pure classifier + persistence helpers. The "every 5 minutes" scheduling
// lives in the cron / route layer; this file just does the math + DB writes.

import 'server-only';
import { supabaseService } from '@/lib/supabase';
import { ADX, ATR } from '@/lib/indicators';
import { getCandles } from '@/lib/polygon/client';
import type { MarketRegime, TradeMode } from '@/types/database';

export interface RegimeInput {
  adx: number;
  atr: number;
  atr20DayAvg: number;
  vixLike?: number | null;     // optional VIX-equivalent (futures contracts may not have it)
  hourET?: number;             // optional time-of-day gate
  newsEventActive?: boolean;   // set true when within blackout window
}

export interface RegimeClassification {
  regime: MarketRegime;
  confidence: number;          // 0..1
  reasoning: string;
  inputs: RegimeInput;
}

// Thresholds — tunable from a single place.
const ADX_TRENDING = 25;
const ADX_RANGING = 20;
const ATR_HIGH_MULT = 1.5;     // 50% above 20d avg
const ATR_EXTREME_MULT = 2.0;  // 100% above 20d avg
const ATR_LOW_FRAC = 0.6;      // 40% below avg = too quiet

export function classifyRegime(input: RegimeInput): RegimeClassification {
  const { adx, atr, atr20DayAvg, newsEventActive } = input;
  const atrRatio = atr20DayAvg > 0 ? atr / atr20DayAvg : 1;

  if (newsEventActive || atrRatio >= ATR_EXTREME_MULT) {
    return {
      regime: 'extreme_volatility',
      confidence: 0.9,
      reasoning: newsEventActive
        ? 'Major news event active; volatility expected to spike.'
        : `ATR is ${(atrRatio * 100).toFixed(0)}% of 20d average. Extreme regime.`,
      inputs: input,
    };
  }

  if (atrRatio >= ATR_HIGH_MULT) {
    return {
      regime: 'high_volatility',
      confidence: 0.8,
      reasoning: `ATR is ${(atrRatio * 100).toFixed(0)}% of 20d average. High volatility.`,
      inputs: input,
    };
  }

  if (atrRatio <= ATR_LOW_FRAC) {
    return {
      regime: 'low_volatility',
      confidence: 0.75,
      reasoning: `ATR is only ${(atrRatio * 100).toFixed(0)}% of 20d average. Range too tight.`,
      inputs: input,
    };
  }

  if (adx >= ADX_TRENDING) {
    return {
      regime: 'trending',
      confidence: Math.min(1, adx / 50),
      reasoning: `ADX ${adx.toFixed(1)} clears trending threshold (${ADX_TRENDING}).`,
      inputs: input,
    };
  }

  if (adx <= ADX_RANGING) {
    return {
      regime: 'ranging',
      confidence: 1 - adx / 50,
      reasoning: `ADX ${adx.toFixed(1)} below ranging threshold (${ADX_RANGING}).`,
      inputs: input,
    };
  }

  // Between 20 and 25 — ambiguous. Default to ranging with low confidence.
  return {
    regime: 'ranging',
    confidence: 0.5,
    reasoning: `ADX ${adx.toFixed(1)} between thresholds. Defaulting to ranging.`,
    inputs: input,
  };
}

export interface RegimeTechnicals {
  adx: number;
  atr: number;            // recent daily ATR (current volatility)
  atr20DayAvg: number;    // baseline daily ATR (normal volatility)
  recentClose: number | null;
  priorClose: number | null;
}

/**
 * Pull live candles and compute the technical inputs the regime classifier
 * needs.
 *
 * Volatility MUST be daily-vs-daily so the ratio is on a comparable scale:
 * `atr` is a short (5-day) daily ATR, `atr20DayAvg` is the 20-day daily ATR.
 * The old code compared a 5-minute ATR against a daily ATR, which yields a
 * permanently tiny ratio (~0.03) that always trips the low_volatility gate and
 * stops the bot from ever trading. ADX stays on intraday bars for trend
 * responsiveness.
 */
export async function regimeTechnicals(instrument: string): Promise<RegimeTechnicals> {
  const intraday = await getCandles(instrument, '5m', 100).catch(() => []);
  const daily = await getCandles(instrument, '1d', 60).catch(() => []);

  const adx = intraday.length >= 28 ? ADX(intraday, 14).adx : 0;
  const atrRecent = daily.length >= 6 ? ATR(daily.slice(-6), 5) : 0;
  const atrBaseline = daily.length >= 21 ? ATR(daily.slice(-21), 20)
                    : atrRecent;

  const n = intraday.length;
  return {
    adx,
    atr: atrRecent,
    atr20DayAvg: atrBaseline,
    recentClose: n >= 1 ? intraday[n - 1].close : null,
    priorClose: n >= 2 ? intraday[n - 2].close : null,
  };
}

/**
 * Pull live data for one instrument and compute its regime. Picks the
 * primary instrument for the mode (defaults to the first match).
 */
export async function computeRegimeForInstrument(
  instrument: string,
  opts: { newsEventActive?: boolean } = {},
): Promise<RegimeClassification> {
  const tech = await regimeTechnicals(instrument);
  return classifyRegime({
    adx: tech.adx,
    atr: tech.atr,
    atr20DayAvg: tech.atr20DayAvg,
    newsEventActive: opts.newsEventActive ?? false,
  });
}

/**
 * Persist a regime classification to bot_status and, if regime changed, log
 * an event to bot_event_log for downstream consumers (UI, audit).
 * Returns whether the regime changed.
 */
export async function persistRegime(
  mode: TradeMode,
  cls: RegimeClassification,
): Promise<{ changed: boolean; previous: MarketRegime | null }> {
  const sb = supabaseService();

  const { data: existing, error: readErr } = await sb
    .from('bot_status')
    .select('regime')
    .eq('mode', mode)
    .single();
  if (readErr) {
    console.error('[regime] failed to read bot_status', readErr);
    return { changed: false, previous: null };
  }

  const previous = existing?.regime ?? null;
  const changed = previous !== cls.regime;

  const { error: updateErr } = await sb
    .from('bot_status')
    .update({ regime: cls.regime })
    .eq('mode', mode);
  if (updateErr) {
    console.error('[regime] failed to update bot_status', updateErr);
    return { changed: false, previous };
  }

  if (changed) {
    const { error: logErr } = await sb.from('bot_event_log').insert({
      mode,
      level: 'info',
      category: 'regime',
      message: `Regime changed: ${previous ?? 'unknown'} → ${cls.regime}`,
      context: {
        previous,
        next: cls.regime,
        confidence: cls.confidence,
        reasoning: cls.reasoning,
        inputs: cls.inputs as unknown as Record<string, unknown>,
      },
    });
    if (logErr) console.error('[regime] failed to log event', logErr);
  }

  return { changed, previous };
}

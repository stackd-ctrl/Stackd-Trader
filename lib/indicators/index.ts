// STACKD TRADER — Pure indicator math.
//
// All functions are pure: input arrays/numbers in, numbers/objects out, no
// side effects, no I/O. Same input → same output. Easy to unit test.

import type { Candle } from '@/lib/polygon/client';

// ============================================================================
// RSI — Relative Strength Index (Wilder smoothing)
// ============================================================================

export function RSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ============================================================================
// EMA helper used by MACD
// ============================================================================

function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out: number[] = new Array(period - 1).fill(NaN);
  out.push(seed);
  for (let i = period; i < values.length; i++) {
    const prev = out[i - 1];
    out.push(values[i] * k + prev * (1 - k));
  }
  return out;
}

// ============================================================================
// MACD
// ============================================================================

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
}

export function MACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MACDResult {
  if (closes.length < slow + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }
  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);
  const macdLine: number[] = closes.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return Number.isFinite(f) && Number.isFinite(s) ? f - s : NaN;
  });
  const valid = macdLine.filter((v) => Number.isFinite(v));
  const signalLine = emaSeries(valid, signalPeriod);
  const macd = macdLine[macdLine.length - 1] ?? 0;
  const signal = signalLine[signalLine.length - 1] ?? 0;
  return { macd, signal, histogram: macd - signal };
}

// ============================================================================
// ATR (Wilder)
// ============================================================================

type HLC = Pick<Candle, 'high' | 'low' | 'close'>;

export function ATR(data: HLC[], period = 14): number {
  if (data.length < period + 1) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const cur = data[i];
    const prev = data[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    trueRanges.push(tr);
  }

  // Wilder seed = simple average of first `period` TR values, then smooth.
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

// ============================================================================
// VOLUME RATIO
// ============================================================================

export function VOLUME_RATIO(volumes: number[], period = 20): number {
  if (volumes.length === 0) return 0;
  const slice = volumes.slice(-Math.max(period, 1));
  const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
  const current = volumes[volumes.length - 1];
  if (avg === 0) return 0;
  return current / avg;
}

// ============================================================================
// ADX (with +DI / -DI)
// ============================================================================

export interface ADXResult {
  adx: number;
  plusDI: number;
  minusDI: number;
}

export function ADX(data: HLC[], period = 14): ADXResult {
  if (data.length < period * 2) {
    return { adx: 0, plusDI: 0, minusDI: 0 };
  }

  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const cur = data[i];
    const prev = data[i - 1];
    const upMove = cur.high - prev.high;
    const downMove = prev.low - cur.low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    ));
  }

  // Wilder smoothing of each series.
  const smooth = (arr: number[]): number[] => {
    const out: number[] = [];
    let sum = arr.slice(0, period).reduce((a, b) => a + b, 0);
    out.push(sum);
    for (let i = period; i < arr.length; i++) {
      sum = sum - sum / period + arr[i];
      out.push(sum);
    }
    return out;
  };

  const trS = smooth(tr);
  const plusS = smooth(plusDM);
  const minusS = smooth(minusDM);

  const dx: number[] = [];
  for (let i = 0; i < trS.length; i++) {
    const pdi = (plusS[i] / trS[i]) * 100;
    const mdi = (minusS[i] / trS[i]) * 100;
    const denom = pdi + mdi;
    dx.push(denom === 0 ? 0 : (Math.abs(pdi - mdi) / denom) * 100);
  }

  // ADX = Wilder smoothing of DX over `period`.
  if (dx.length < period) return { adx: 0, plusDI: 0, minusDI: 0 };
  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }

  const lastIdx = trS.length - 1;
  return {
    adx,
    plusDI: (plusS[lastIdx] / trS[lastIdx]) * 100,
    minusDI: (minusS[lastIdx] / trS[lastIdx]) * 100,
  };
}

// ============================================================================
// Bollinger Bands
// ============================================================================

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
}

export function BOLLINGER_BANDS(
  closes: number[],
  period = 20,
  stdDev = 2,
): BollingerResult {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return {
    middle: mean,
    upper: mean + stdDev * sd,
    lower: mean - stdDev * sd,
  };
}

// ============================================================================
// Key level detection — swing highs / lows clustered by proximity
// ============================================================================

export type KeyLevelType = 'support' | 'resistance';

export interface KeyLevel {
  price: number;
  type: KeyLevelType;
  strength: 1 | 2 | 3;   // # of times tested (1=weak, 3=strong)
}

export function KEY_LEVEL_DETECTION(
  data: Candle[],
  lookback = 50,
): KeyLevel[] {
  if (data.length < 5) return [];
  const window = data.slice(-lookback);
  const swings: { price: number; type: KeyLevelType }[] = [];

  // 2-bar swing: middle bar is strictly higher (high) or lower (low) than its neighbors.
  for (let i = 2; i < window.length - 2; i++) {
    const c = window[i];
    const isSwingHigh =
      c.high > window[i - 1].high &&
      c.high > window[i - 2].high &&
      c.high > window[i + 1].high &&
      c.high > window[i + 2].high;
    const isSwingLow =
      c.low < window[i - 1].low &&
      c.low < window[i - 2].low &&
      c.low < window[i + 1].low &&
      c.low < window[i + 2].low;

    if (isSwingHigh) swings.push({ price: c.high, type: 'resistance' });
    if (isSwingLow)  swings.push({ price: c.low,  type: 'support' });
  }

  // Cluster swings within 0.25% of each other; strength = cluster size, capped at 3.
  const avgPrice = window.reduce((a, b) => a + b.close, 0) / window.length;
  const tolerance = avgPrice * 0.0025;

  const clustered: KeyLevel[] = [];
  for (const s of swings) {
    const existing = clustered.find(
      (k) => k.type === s.type && Math.abs(k.price - s.price) <= tolerance,
    );
    if (existing) {
      const bumped = Math.min(3, existing.strength + 1);
      existing.strength = bumped as 1 | 2 | 3;
      // Average the price toward the new touch.
      existing.price = (existing.price + s.price) / 2;
    } else {
      clustered.push({ ...s, strength: 1 });
    }
  }

  return clustered.sort((a, b) => b.strength - a.strength);
}

// ============================================================================
// Helper — detect a clean break-and-close above/below the nearest key level
// ============================================================================

export function detectKeyLevelBreak(data: Candle[]): boolean {
  if (data.length < 5) return false;
  const levels = KEY_LEVEL_DETECTION(data);
  if (levels.length === 0) return false;

  const last = data[data.length - 1];
  const prev = data[data.length - 2];

  for (const lvl of levels) {
    if (lvl.type === 'resistance' && prev.close < lvl.price && last.close > lvl.price) {
      // Body close above the level (not just a wick).
      if (last.close > lvl.price + (last.high - last.low) * 0.1) return true;
    }
    if (lvl.type === 'support' && prev.close > lvl.price && last.close < lvl.price) {
      if (last.close < lvl.price - (last.high - last.low) * 0.1) return true;
    }
  }
  return false;
}

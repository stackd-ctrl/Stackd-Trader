// STACKD TRADER — Stop loss + take profit calculator.

import { instrumentByKey } from '@/lib/instruments';
import type { TradeDirection, TradeStrategy } from '@/types/database';

export interface LevelsResult {
  stopLoss: number;
  takeProfit: number;
  rewardToRisk: number;
}

export interface LevelsInput {
  instrument: string;
  direction: TradeDirection;
  entryPrice: number;
  atr: number;
  strategy: TradeStrategy;
  /** Required for mean_reversion strategy; ignored otherwise. */
  movingAverage20?: number;
}

function roundToTick(value: number, tickSize: number): number {
  if (tickSize <= 0) return Number(value.toFixed(2));
  const rounded = Math.round(value / tickSize) * tickSize;
  return Number(rounded.toFixed(4));
}

export function calculateLevels(input: LevelsInput): LevelsResult {
  const inst = instrumentByKey(input.instrument);
  const tick = inst?.tickSize ?? 0.01;
  const minStop = inst?.minStopPoints ?? 0;
  const isLong = input.direction === 'long';

  // ---- Stop loss multiplier per strategy ----
  const stopMult =
    input.strategy === 'momentum'        ? 1.2 :
    input.strategy === 'mean_reversion'  ? 1.5 :
                                            1.0;   // news_sentiment

  let stopDistance = input.atr * stopMult;
  // Enforce per-instrument minimum stop distance (in points).
  if (stopDistance < minStop) stopDistance = minStop;

  const stopLoss = roundToTick(
    isLong ? input.entryPrice - stopDistance : input.entryPrice + stopDistance,
    tick,
  );

  // ---- Take profit per strategy ----
  let takeProfit: number;
  if (input.strategy === 'mean_reversion') {
    // Target = 20-period MA. If we don't have it, fall back to ATR-based.
    if (typeof input.movingAverage20 === 'number') {
      takeProfit = roundToTick(input.movingAverage20, tick);
    } else {
      const tpMult = 2.0;
      takeProfit = roundToTick(
        isLong ? input.entryPrice + input.atr * tpMult : input.entryPrice - input.atr * tpMult,
        tick,
      );
    }
  } else if (input.strategy === 'momentum') {
    const tpMult = 2.2;
    takeProfit = roundToTick(
      isLong ? input.entryPrice + input.atr * tpMult : input.entryPrice - input.atr * tpMult,
      tick,
    );
  } else {
    // news_sentiment
    const tpMult = 1.8;
    takeProfit = roundToTick(
      isLong ? input.entryPrice + input.atr * tpMult : input.entryPrice - input.atr * tpMult,
      tick,
    );
  }

  // ---- Reward / risk ----
  const risk = Math.abs(input.entryPrice - stopLoss);
  const reward = Math.abs(takeProfit - input.entryPrice);
  const rewardToRisk = risk <= 0 ? 0 : Number((reward / risk).toFixed(2));

  return { stopLoss, takeProfit, rewardToRisk };
}

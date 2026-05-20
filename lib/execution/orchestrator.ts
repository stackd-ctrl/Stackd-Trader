// STACKD TRADER — Strategy orchestrator. Master controller for signal → trade.

import 'server-only';
import { supabaseService } from '@/lib/supabase';
import { runSignalScan as runTechnicalScan } from '@/lib/signals/generator';
import { scoreNewsSentiment } from '@/lib/claude/sentiment';
import { explainSignal } from '@/lib/claude/signals';
import { calculateLevels } from './levels';
import { calculatePositionSize } from './positionSizer';
import { passesRiskGuard } from './riskGuard';
import { passesTopstepGuard } from './topstepGuard';
import { executeEntry } from './orderExecutor';
import { getAccount } from '@/lib/alpaca/client';
import { getSnapshot } from '@/lib/marketData';
import { isMarketHours, isCryptoSession } from '@/lib/time';
import { instrumentByKey, instrumentsForMode } from '@/lib/instruments';
import { computeRegimeForInstrument, persistRegime } from '@/lib/regime/detector';
import { ENTER_THRESHOLD, SIGNAL_WEIGHTS } from '@/lib/constants';
import type {
  MarketRegime,
  Signal,
  TradeMode,
} from '@/types/database';

export interface ProcessSignalResult {
  status: 'executed' | 'skipped';
  reason: string;
  tradeId?: string;
}

function sentimentToFactor(raw: number): number {
  const v = (raw + 10) / 2;
  return Math.max(0, Math.min(10, v));
}

export async function processSignal(signal: Signal, mode: TradeMode): Promise<ProcessSignalResult> {
  // Step 1: score gate.
  if (signal.total_score < ENTER_THRESHOLD) {
    return { status: 'skipped', reason: `score ${signal.total_score} below threshold ${ENTER_THRESHOLD}` };
  }
  if (!signal.direction) {
    return { status: 'skipped', reason: 'signal missing direction' };
  }

  const inst = instrumentByKey(signal.instrument);
  if (!inst) return { status: 'skipped', reason: `unknown instrument ${signal.instrument}` };
  if (!inst.alpacaSymbol) {
    return { status: 'skipped', reason: `${signal.instrument} not tradable on Alpaca (futures broker required)` };
  }

  // Step 2: current price + ATR + account balance.
  let currentPrice: number;
  try {
    const snap = await getSnapshot(signal.instrument);
    currentPrice = snap.price;
  } catch (err) {
    return { status: 'skipped', reason: `snapshot failed: ${(err as Error).message}` };
  }
  if (!signal.atr || signal.atr <= 0) {
    return { status: 'skipped', reason: 'signal missing ATR' };
  }

  let accountBalance = 100_000;
  try { accountBalance = (await getAccount()).equity; } catch { /* paper default */ }

  // Step 3: levels.
  const levels = calculateLevels({
    instrument: signal.instrument,
    direction: signal.direction,
    entryPrice: currentPrice,
    atr: signal.atr,
    strategy: signal.strategy,
  });

  // Drawdown from latest snapshot for position sizing.
  const sb = supabaseService();
  const { data: snap } = await sb
    .from('account_snapshots').select('peak_equity').eq('mode', mode)
    .order('snapshot_at', { ascending: false }).limit(1).maybeSingle();
  const peak = snap?.peak_equity ?? accountBalance;
  const drawdownPct = peak > 0 ? ((peak - accountBalance) / peak) * 100 : 0;

  // Step 4: size.
  const sizeResult = calculatePositionSize(
    accountBalance,
    currentPrice,
    levels.stopLoss,
    signal.instrument,
    signal.total_score,
    'full',  // Claude's sizing recommendation flows in via explainSignal; default to full here
    drawdownPct,
  );
  if (sizeResult.contracts < 1) {
    return { status: 'skipped', reason: 'position size rounded to 0' };
  }

  // Step 5: risk guard.
  const guard = await passesRiskGuard({
    mode,
    instrument: signal.instrument,
    strategy: signal.strategy,
    proposedEntry: currentPrice,
    proposedStop: levels.stopLoss,
    proposedTarget: levels.takeProfit,
    proposedSize: sizeResult.contracts,
  });
  if (!guard.approved) {
    return { status: 'skipped', reason: `risk guard: ${guard.reason}` };
  }
  let finalSize = guard.adjustedSize ?? sizeResult.contracts;

  // Step 5b: Topstep guard (only when mode is topstep).
  if (mode === 'topstep') {
    const { data: risk } = await sb.from('risk_settings').select('*').eq('mode', mode).single();
    if (risk) {
      const tg = await passesTopstepGuard({
        instrument: signal.instrument,
        proposedTradeSize: finalSize,
        currentAccountBalance: accountBalance,
        startingEvaluationBalance: 50_000,  // Day 5: read from a topstep_evaluation table
        topstepSettings: risk,
      });
      if (!tg.approved) return { status: 'skipped', reason: `topstep guard: ${tg.reason}` };
      if (tg.adjustedSize) finalSize = tg.adjustedSize;
    }
  }

  // Step 6: execute.
  const result = await executeEntry({
    signal,
    direction: signal.direction,
    entryPrice: currentPrice,
    stopLoss: levels.stopLoss,
    takeProfit: levels.takeProfit,
    size: finalSize,
    mode,
  });

  if (!result.success) {
    return { status: 'skipped', reason: `executeEntry failed: ${result.error ?? 'unknown'}` };
  }
  return { status: 'executed', reason: 'order placed', tradeId: result.tradeId ?? undefined };
}

// ---- runSignalScan: master loop tying technical scan → Claude → execution ---

const STRATEGIES_BY_REGIME: Record<MarketRegime, Array<{ strategy: 'momentum' | 'mean_reversion' | 'news_sentiment'; weight: number }>> = {
  trending:           [{ strategy: 'momentum', weight: 0.5 }, { strategy: 'news_sentiment', weight: 0.2 }],
  ranging:            [{ strategy: 'mean_reversion', weight: 0.3 }, { strategy: 'news_sentiment', weight: 0.2 }],
  high_volatility:    [{ strategy: 'momentum', weight: 0.25 }, { strategy: 'mean_reversion', weight: 0.15 }, { strategy: 'news_sentiment', weight: 0.1 }],
  extreme_volatility: [],   // sit out
  low_volatility:     [],   // sit out
};

export interface RunSignalScanResult {
  scanned: boolean;
  reason?: string;
  scan?: Awaited<ReturnType<typeof runTechnicalScan>>;
  processed?: Array<{ instrument: string; status: 'executed' | 'skipped'; reason: string; tradeId?: string }>;
}

export async function runSignalScan(mode: TradeMode): Promise<RunSignalScanResult> {
  const sb = supabaseService();

  // Step 1: should bot run?
  const { data: status } = await sb
    .from('bot_status')
    .select('is_active, daily_loss_limit_hit, paused_until, regime')
    .eq('mode', mode)
    .single();
  if (!status) return { scanned: false, reason: 'no bot_status row' };
  if (!status.is_active)            return { scanned: false, reason: 'bot inactive' };
  if (status.daily_loss_limit_hit)  return { scanned: false, reason: 'daily loss limit hit' };
  if (status.paused_until && new Date(status.paused_until).getTime() > Date.now()) {
    return { scanned: false, reason: 'bot in cooldown' };
  }

  // Market hours check — but allow crypto-only scans when futures market is closed.
  const cryptoTradable = instrumentsForMode(mode).some((i) => i.class === 'crypto') && isCryptoSession();
  const equitiesTradable = isMarketHours();
  if (!cryptoTradable && !equitiesTradable) {
    return { scanned: false, reason: 'no tradable session' };
  }

  // Step 2: refresh the regime from live data so the gate reflects current
  // conditions, not just the weekday 9am morning cron (crypto trades 24/7).
  // Falls back to the stored regime if the recompute fails.
  let regime: MarketRegime = status.regime;
  try {
    const primary = instrumentsForMode(mode)[0]?.key;
    if (primary) {
      const cls = await computeRegimeForInstrument(primary);
      await persistRegime(mode, cls);
      regime = cls.regime;
    }
  } catch (err) {
    console.error('[orchestrator] regime recompute failed; using stored regime', err);
  }

  // Step 3: active strategies.
  const allowed = STRATEGIES_BY_REGIME[regime] ?? [];
  if (allowed.length === 0) return { scanned: false, reason: `regime ${regime} disabled` };
  const allowedSet = new Set(allowed.map((a) => a.strategy));

  // Step 4: run technical scan.
  const scan = await runTechnicalScan(mode);

  // Step 5: process each signal that cleared the raw threshold; serialise with 5s gap.
  const processed: RunSignalScanResult['processed'] = [];

  for (const raw of scan.generated) {
    // Strategy must be allowed in current regime.
    if (!allowedSet.has(raw.strategy)) {
      processed.push({ instrument: raw.instrument, status: 'skipped', reason: `strategy ${raw.strategy} disabled in regime ${regime}` });
      continue;
    }

    // Fetch the signal row id just inserted by runTechnicalScan.
    const { data: row } = await sb.from('signals').select('*').eq('mode', mode)
      .eq('instrument', raw.instrument).order('created_at', { ascending: false }).limit(1).single();
    if (!row) {
      processed.push({ instrument: raw.instrument, status: 'skipped', reason: 'signal row not found' });
      continue;
    }

    // Sentiment pass.
    const sentiment = await scoreNewsSentiment(null, raw.instrument);
    const sentFactor = sentimentToFactor(sentiment.score);

    // Build proposed levels for Claude's explainSignal (uses same math as orchestrator).
    let snapPrice = raw.atr * 50;  // last-resort default
    try { snapPrice = (await getSnapshot(raw.instrument)).price; } catch { /* keep default */ }
    const levels = calculateLevels({
      instrument: raw.instrument,
      direction: raw.direction,
      entryPrice: snapPrice,
      atr: raw.atr,
      strategy: raw.strategy,
    });

    const enrichedScore = raw.raw_score + sentFactor * (SIGNAL_WEIGHTS.sentiment / 10);

    const explanation = await explainSignal({
      signal_id: row.id,
      instrument: raw.instrument,
      strategy: raw.strategy,
      direction: raw.direction,
      rsi: raw.rsi,
      rsi_score: raw.factor_scores.rsi,
      macd_histogram: raw.macd_histogram,
      macd_score: raw.factor_scores.macd,
      volume_ratio: raw.volume_ratio,
      volume_score: raw.factor_scores.volume,
      key_level_break: raw.key_level_break,
      key_level_score: raw.factor_scores.keyLevel,
      atr: raw.atr,
      atr_score: raw.factor_scores.atr,
      regime: raw.regime,
      regime_score: raw.factor_scores.regime,
      sentiment_score_0to10: sentFactor,
      sentiment_raw: sentiment.score,
      raw_score: enrichedScore,
      entry_price: snapPrice,
      stop_loss: levels.stopLoss,
      take_profit: levels.takeProfit,
    });

    if (explanation.action !== 'enter') {
      processed.push({ instrument: raw.instrument, status: 'skipped', reason: `Claude verdict: skip (${explanation.confidence})` });
      continue;
    }

    // Re-fetch the signal (explainSignal updated it).
    const { data: refreshed } = await sb.from('signals').select('*').eq('id', row.id).single();
    if (!refreshed) {
      processed.push({ instrument: raw.instrument, status: 'skipped', reason: 'signal disappeared after Claude update' });
      continue;
    }

    const proc = await processSignal(refreshed, mode);
    processed.push({ instrument: raw.instrument, ...proc });

    // 5s gap between executions to prevent rapid-fire entries.
    await new Promise((r) => setTimeout(r, 5_000));
  }

  return { scanned: true, scan, processed };
}

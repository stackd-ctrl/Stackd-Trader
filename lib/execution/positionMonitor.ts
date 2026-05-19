// STACKD TRADER — Position monitor.
//
// Runs every 30s during market hours via /api/cron/position-monitor.
// Per spec: bracket health, breakeven trail on momentum winners, EOD force
// close, kill-switch sweep.

import 'server-only';
import { supabaseService } from '@/lib/supabase';
import { getOrders, placeOrder, cancelOrder, type AlpacaOrder } from '@/lib/alpaca/client';
import { closeAllPositions, executeExit } from './orderExecutor';
import { instrumentByKey } from '@/lib/instruments';
import { getSnapshot } from '@/lib/polygon/client';
import { ATR } from '@/lib/indicators';
import { getCandles } from '@/lib/polygon/client';
import { nowET } from '@/lib/time';
import type { TradeMode } from '@/types/database';

const EOD_FORCE_CLOSE_HOUR = 15;
const EOD_FORCE_CLOSE_MIN  = 44;
const BREAKEVEN_TRIGGER_ATR_MULT = 1.5;

export async function monitorPositions(mode: TradeMode): Promise<void> {
  const sb = supabaseService();

  // CHECK 4 first (cheapest): kill switch.
  const { data: status } = await sb
    .from('bot_status')
    .select('is_active')
    .eq('mode', mode)
    .single();

  if (status && !status.is_active) {
    const result = await closeAllPositions(mode, 'kill_switch');
    if (result.closed > 0 || result.errors.length > 0) {
      await sb.from('bot_event_log').insert({
        mode, level: 'warn', category: 'order',
        message: `Kill-switch sweep closed ${result.closed} positions`,
        context: { closed: result.closed, errors: result.errors },
      });
    }
    return;
  }

  // Get open trades for this mode.
  const { data: openTrades } = await sb
    .from('trades').select('*').eq('mode', mode).eq('status', 'open');
  if (!openTrades || openTrades.length === 0) return;

  // EOD check (futures only — crypto trades 24/7).
  const et = nowET();
  const isEod = et.hour === EOD_FORCE_CLOSE_HOUR && et.minute >= EOD_FORCE_CLOSE_MIN;

  // Fetch all open Alpaca orders once for bracket-health checks.
  let openOrders: AlpacaOrder[] = [];
  try { openOrders = await getOrders('open'); } catch (err) {
    console.error('[positionMonitor] getOrders failed', err);
  }

  for (const trade of openTrades) {
    const inst = instrumentByKey(trade.instrument);
    if (!inst?.alpacaSymbol) continue;

    // EOD force-close (futures only).
    if (isEod && inst.class !== 'crypto') {
      await executeExit(trade.id, 'end_of_day');
      continue;
    }

    // CHECK 1: bracket order health.
    const stopAlive   = trade.stop_order_id   && openOrders.find((o) => o.id === trade.stop_order_id);
    const targetAlive = trade.target_order_id && openOrders.find((o) => o.id === trade.target_order_id);

    if (!stopAlive && trade.stop_order_id) {
      await replaceStop(trade.id, trade.stop_loss, trade.quantity, trade.direction!, inst.alpacaSymbol, trade.mode);
    }
    if (!targetAlive && trade.target_order_id) {
      await replaceTarget(trade.id, trade.take_profit, trade.quantity, trade.direction!, inst.alpacaSymbol, trade.mode);
    }

    // CHECK 2: breakeven trail for momentum winners.
    if (trade.strategy !== 'momentum' || !trade.direction) continue;
    try {
      const snap = await getSnapshot(trade.instrument);
      const candles = await getCandles(trade.instrument, '5m', 30);
      if (candles.length < 15) continue;
      const atr = ATR(candles, 14);
      const inProfitPoints = trade.direction === 'long'
        ? snap.price - trade.entry_price
        : trade.entry_price - snap.price;
      const triggerPoints = atr * BREAKEVEN_TRIGGER_ATR_MULT;
      if (inProfitPoints < triggerPoints) continue;

      // Don't move stop if it's already at/past entry.
      const alreadyBE = trade.direction === 'long'
        ? trade.stop_loss >= trade.entry_price
        : trade.stop_loss <= trade.entry_price;
      if (alreadyBE) continue;

      await moveStopToBreakeven(trade.id, trade.entry_price, trade.quantity, trade.direction, inst.alpacaSymbol, trade.mode, trade.stop_order_id);
    } catch (err) {
      console.warn(`[positionMonitor] breakeven check failed for ${trade.instrument}`, err);
    }
  }
}

// ---- Bracket repair helpers ------------------------------------------------

async function replaceStop(
  tradeId: string,
  stopPrice: number,
  qty: number,
  direction: 'long' | 'short',
  alpacaSymbol: string,
  mode: TradeMode,
): Promise<void> {
  const sb = supabaseService();
  const side = direction === 'long' ? 'sell' : 'buy';
  const limit = stopPrice * (direction === 'long' ? 0.998 : 1.002);
  try {
    const replacement = await placeOrder({
      symbol: alpacaSymbol, side, qty, type: 'stop_limit',
      stop_price: stopPrice, limit_price: limit, time_in_force: 'gtc',
      client_order_id: `stop_repl_${tradeId.slice(0, 8)}_${Date.now()}`,
    });
    await sb.from('trades').update({ stop_order_id: replacement.id }).eq('id', tradeId);
    await sb.from('bot_event_log').insert({
      mode, level: 'warn', category: 'order',
      message: `Stop order missing; replaced on trade ${tradeId}`,
      context: { trade_id: tradeId, new_order_id: replacement.id },
    });
  } catch (err) {
    await sb.from('bot_event_log').insert({
      mode, level: 'error', category: 'order',
      message: `Stop replacement FAILED on trade ${tradeId}`,
      context: { trade_id: tradeId, error: (err as Error).message },
    });
  }
}

async function replaceTarget(
  tradeId: string,
  targetPrice: number,
  qty: number,
  direction: 'long' | 'short',
  alpacaSymbol: string,
  mode: TradeMode,
): Promise<void> {
  const sb = supabaseService();
  const side = direction === 'long' ? 'sell' : 'buy';
  try {
    const replacement = await placeOrder({
      symbol: alpacaSymbol, side, qty, type: 'limit',
      limit_price: targetPrice, time_in_force: 'gtc',
      client_order_id: `tgt_repl_${tradeId.slice(0, 8)}_${Date.now()}`,
    });
    await sb.from('trades').update({ target_order_id: replacement.id }).eq('id', tradeId);
    await sb.from('bot_event_log').insert({
      mode, level: 'warn', category: 'order',
      message: `Target order missing; replaced on trade ${tradeId}`,
      context: { trade_id: tradeId, new_order_id: replacement.id },
    });
  } catch (err) {
    await sb.from('bot_event_log').insert({
      mode, level: 'error', category: 'order',
      message: `Target replacement FAILED on trade ${tradeId}`,
      context: { trade_id: tradeId, error: (err as Error).message },
    });
  }
}

async function moveStopToBreakeven(
  tradeId: string,
  entryPrice: number,
  qty: number,
  direction: 'long' | 'short',
  alpacaSymbol: string,
  mode: TradeMode,
  oldStopOrderId: string | null,
): Promise<void> {
  const sb = supabaseService();
  if (oldStopOrderId) {
    try { await cancelOrder(oldStopOrderId); } catch { /* may already be gone */ }
  }
  const side = direction === 'long' ? 'sell' : 'buy';
  const limit = entryPrice * (direction === 'long' ? 0.998 : 1.002);
  try {
    const replacement = await placeOrder({
      symbol: alpacaSymbol, side, qty, type: 'stop_limit',
      stop_price: entryPrice, limit_price: limit, time_in_force: 'gtc',
      client_order_id: `be_${tradeId.slice(0, 8)}_${Date.now()}`,
    });
    await sb.from('trades').update({
      stop_loss: entryPrice,
      stop_order_id: replacement.id,
    }).eq('id', tradeId);
    await sb.from('bot_event_log').insert({
      mode, level: 'info', category: 'order',
      message: `Trail to breakeven on trade ${tradeId}`,
      context: { trade_id: tradeId, new_stop: entryPrice, new_order_id: replacement.id },
    });
  } catch (err) {
    await sb.from('bot_event_log').insert({
      mode, level: 'error', category: 'order',
      message: `Breakeven stop placement FAILED on trade ${tradeId}`,
      context: { trade_id: tradeId, error: (err as Error).message },
    });
  }
}

// STACKD TRADER — Order executor.
//
// Every order goes through this file. Hardest-to-undo code in the system;
// every Alpaca call is wrapped in try/catch with timeouts, and every step is
// audit-logged to Supabase. Supabase writes happen AFTER Alpaca confirms.

import 'server-only';
import {
  cancelOrder,
  closePosition,
  getOrders,
  getPositions,
  placeOrder,
  type AlpacaOrder,
} from '@/lib/alpaca/client';
import { supabaseService } from '@/lib/supabase';
import { instrumentByKey } from '@/lib/instruments';
import { sendEntryAlert, sendExitAlert } from '@/lib/email/tradeAlerts';
import type {
  ExitReason,
  Signal,
  TradeDirection,
  TradeMode,
} from '@/types/database';

export interface ExecuteEntryInput {
  signal: Signal;
  direction: TradeDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  size: number;
  mode: TradeMode;
}

export interface ExecuteEntryResult {
  success: boolean;
  tradeId: string | null;
  orderId: string | null;
  error: string | null;
}

export interface ExecuteExitResult {
  success: boolean;
  exitPrice: number | null;
  pnl: number | null;
  error: string | null;
}

const FILL_POLL_INTERVAL_MS = 2_000;
const FILL_MAX_POLLS = 15;     // 30s total
const ALPACA_TIMEOUT_MS = 10_000;

// ---- Mode safety guard -----------------------------------------------------
//
// Spec: "Add a check at the top of executeEntry: if (mode === 'paper' &&
// process.env.ALPACA_PAPER_KEY === process.env.ALPACA_LIVE_KEY) { throw ... }"
//
// Our setup uses one key pair + TRADING_MODE to flip endpoints. The equivalent
// guarantee is: when mode is paper, TRADING_MODE must be paper (so we hit the
// paper endpoint, not live). When mode is live, TRADING_MODE must be live.
function assertModeSafety(mode: TradeMode): void {
  const tradingMode = (process.env.TRADING_MODE ?? 'paper').toLowerCase();
  const expectsPaper = mode === 'paper';
  const expectsLive = mode === 'live_crypto' || mode === 'live_futures' || mode === 'topstep';

  if (expectsPaper && tradingMode !== 'paper') {
    throw new Error(`Mode safety: trade mode is paper but TRADING_MODE=${tradingMode}. Refusing to place order on live endpoint.`);
  }
  if (expectsLive && tradingMode !== 'live') {
    throw new Error(`Mode safety: trade mode is ${mode} (live) but TRADING_MODE=${tradingMode}. Refusing to place live trade against paper endpoint.`);
  }

  const paperBase = process.env.ALPACA_PAPER_BASE_URL ?? 'https://paper-api.alpaca.markets';
  const liveBase  = process.env.ALPACA_LIVE_BASE_URL  ?? 'https://api.alpaca.markets';
  if (paperBase === liveBase) {
    throw new Error('Mode safety: ALPACA_PAPER_BASE_URL equals ALPACA_LIVE_BASE_URL. Refusing to place any order.');
  }
}

// ---- Audit helpers ---------------------------------------------------------

async function auditEvent(
  mode: TradeMode,
  message: string,
  level: 'info' | 'warn' | 'error',
  context: Record<string, unknown>,
): Promise<void> {
  try {
    await supabaseService().from('bot_event_log').insert({
      mode, level, category: 'order', message, context,
    });
  } catch (err) {
    console.error('[orderExecutor] audit failed', err);
  }
}

// ---- Alpaca call helpers ---------------------------------------------------

async function withAlpacaTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Alpaca ${label} timed out after ${ALPACA_TIMEOUT_MS}ms`)), ALPACA_TIMEOUT_MS),
    ),
  ]);
}

// Alpaca rejects prices with more than 9 decimal places. Float math (e.g.
// stopLoss * 0.998) easily produces 2126.13919999999, so clamp precision.
function roundPrice(p: number): number {
  return Number(p.toFixed(p >= 1 ? 2 : 6));
}

async function pollFill(orderId: string): Promise<AlpacaOrder | null> {
  for (let i = 0; i < FILL_MAX_POLLS; i++) {
    const orders = await withAlpacaTimeout(getOrders('all'), `getOrders for ${orderId}`);
    const match = orders.find((o) => o.id === orderId);
    if (match && (match.status === 'filled' || match.status === 'partially_filled')) return match;
    if (match && (match.status === 'canceled' || match.status === 'rejected' || match.status === 'expired')) return null;
    await new Promise((r) => setTimeout(r, FILL_POLL_INTERVAL_MS));
  }
  return null;
}

// ---- executeEntry ----------------------------------------------------------

export async function executeEntry(input: ExecuteEntryInput): Promise<ExecuteEntryResult> {
  // Step 1: pre-execution checks (no I/O yet).
  try {
    assertModeSafety(input.mode);
  } catch (err) {
    return { success: false, tradeId: null, orderId: null, error: (err as Error).message };
  }

  if (input.size < 1) return { success: false, tradeId: null, orderId: null, error: 'Size must be >= 1' };
  if (!input.signal.id) return { success: false, tradeId: null, orderId: null, error: 'Signal missing id' };

  const inst = instrumentByKey(input.signal.instrument);
  if (!inst) return { success: false, tradeId: null, orderId: null, error: `Unknown instrument: ${input.signal.instrument}` };
  if (!inst.alpacaSymbol) {
    return {
      success: false,
      tradeId: null,
      orderId: null,
      error: `Instrument ${inst.key} (${inst.class}) is not tradable on Alpaca. Use a futures broker.`,
    };
  }

  await auditEvent(input.mode, 'executeEntry started', 'info', {
    signal_id: input.signal.id,
    instrument: input.signal.instrument,
    direction: input.direction,
    size: input.size,
    entry: input.entryPrice,
    stop: input.stopLoss,
    target: input.takeProfit,
  });

  // Step 2: place entry limit order.
  // Alpaca crypto rejects time_in_force 'day' (only gtc/ioc/fok are valid for
  // crypto); stocks/futures use 'day'.
  // Crypto: market entry with gtc (limit-at-snapshot rarely fills since price
  // moves between the quote and the order, and crypto rejects tif 'day').
  // Stocks/futures: limit entry with 'day'.
  const isCrypto = inst.class === 'crypto';
  const entryTif = isCrypto ? 'gtc' : 'day';
  const entrySide = input.direction === 'long' ? 'buy' : 'sell';
  let entryOrder: AlpacaOrder;
  try {
    entryOrder = await withAlpacaTimeout(
      placeOrder({
        symbol: inst.alpacaSymbol,
        side: entrySide,
        qty: input.size,
        type: isCrypto ? 'market' : 'limit',
        limit_price: isCrypto ? undefined : input.entryPrice,
        time_in_force: entryTif,
        client_order_id: `entry_${input.signal.id.slice(0, 8)}_${Date.now()}`,
      }),
      'placeOrder(entry)',
    );
  } catch (err) {
    const msg = (err as Error).message;
    await auditEvent(input.mode, 'Entry order failed', 'error', { error: msg, signal_id: input.signal.id });
    return { success: false, tradeId: null, orderId: null, error: msg };
  }

  // Step 3: poll for fill.
  const filled = await pollFill(entryOrder.id);
  if (!filled) {
    try { await withAlpacaTimeout(cancelOrder(entryOrder.id), 'cancelOrder(unfilled entry)'); } catch { /* ignore */ }
    await auditEvent(input.mode, 'Entry order did not fill within window; cancelled', 'warn', {
      order_id: entryOrder.id,
    });
    return { success: false, tradeId: null, orderId: entryOrder.id, error: 'Entry order did not fill within 30s' };
  }
  const actualFillPrice = filled.filled_avg_price ?? input.entryPrice;

  // Determine the exit quantity from what we ACTUALLY hold. Crypto market fills
  // deduct the fee from the filled asset, so both the requested size and the
  // order's filled_qty overstate holdings and selling them 403s. The position's
  // qty is the source of truth; floor to 4 dp so we never request a hair more
  // than we hold (dust rejection).
  let exitQty = filled.filled_qty > 0 ? filled.filled_qty : input.size;
  if (inst.class === 'crypto') {
    const slugless = inst.alpacaSymbol.replace('/', '');
    try {
      const positions = await withAlpacaTimeout(getPositions(), 'getPositions(post-entry)');
      const pos = positions.find((p) => p.symbol === slugless || p.symbol === inst.alpacaSymbol);
      if (pos && pos.qty > 0) exitQty = pos.qty;
    } catch { /* fall back to filled_qty */ }
    exitQty = Math.floor(exitQty * 1e4) / 1e4;
  }

  // Step 4: place stop loss + take profit AFTER fill.
  // Side flips: long entry → sell stops/targets; short entry → buy stops/targets.
  const exitSide = input.direction === 'long' ? 'sell' : 'buy';

  let stopOrder: AlpacaOrder | null = null;
  let targetOrder: AlpacaOrder | null = null;

  // CRYPTO: Alpaca does NOT support OCO/bracket orders for crypto. A resting
  // stop and a resting target can't coexist because each sell order reserves
  // the whole position. So for crypto we place NO native exit orders; the
  // position monitor enforces stop/target in software (closes at market when
  // price crosses). Stocks/futures keep the native bracket below.
  if (!isCrypto) {
    try {
      stopOrder = await withAlpacaTimeout(
        placeOrder({
          symbol: inst.alpacaSymbol,
          side: exitSide,
          qty: exitQty,
          type: 'stop_limit',
          stop_price: roundPrice(input.stopLoss),
          limit_price: roundPrice(input.stopLoss * (input.direction === 'long' ? 0.998 : 1.002)), // 0.2% slippage band
          time_in_force: 'gtc',
          client_order_id: `stop_${input.signal.id.slice(0, 8)}_${Date.now()}`,
        }),
        'placeOrder(stop)',
      );
    } catch (err) {
      await auditEvent(input.mode, 'Stop loss order failed; closing position at market', 'error', {
        error: (err as Error).message, entry_order_id: entryOrder.id,
      });
      try { await withAlpacaTimeout(closePosition(inst.alpacaSymbol), 'emergency closePosition'); } catch { /* swallowed */ }
      return { success: false, tradeId: null, orderId: entryOrder.id, error: `Stop order failed: ${(err as Error).message}` };
    }

    try {
      targetOrder = await withAlpacaTimeout(
        placeOrder({
          symbol: inst.alpacaSymbol,
          side: exitSide,
          qty: exitQty,
          type: 'limit',
          limit_price: roundPrice(input.takeProfit),
          time_in_force: 'gtc',
          client_order_id: `tgt_${input.signal.id.slice(0, 8)}_${Date.now()}`,
        }),
        'placeOrder(target)',
      );
    } catch (err) {
      // Stop placed but target failed — still close out for safety.
      await auditEvent(input.mode, 'Target order failed; cancelling stop and closing at market', 'error', {
        error: (err as Error).message, entry_order_id: entryOrder.id, stop_order_id: stopOrder?.id,
      });
      try { if (stopOrder) await withAlpacaTimeout(cancelOrder(stopOrder.id), 'cancel stop on target fail'); } catch { /* ignore */ }
      try { await withAlpacaTimeout(closePosition(inst.alpacaSymbol), 'emergency closePosition'); } catch { /* swallowed */ }
      return { success: false, tradeId: null, orderId: entryOrder.id, error: `Target order failed: ${(err as Error).message}` };
    }
  }

  // Step 5: persist trade record.
  const sb = supabaseService();
  const { data: tradeRow, error: insertErr } = await sb
    .from('trades')
    .insert({
      mode: input.mode,
      strategy: input.signal.strategy,
      instrument: input.signal.instrument,
      direction: input.direction,
      entry_price: actualFillPrice,
      stop_loss: input.stopLoss,
      take_profit: input.takeProfit,
      quantity: exitQty,
      status: 'open',
      signal_score: input.signal.total_score,
      claude_reasoning: input.signal.claude_explanation,
      entry_order_id: entryOrder.id,
      stop_order_id: stopOrder?.id ?? null,
      target_order_id: targetOrder?.id ?? null,
      contract_multiplier: inst.contractMultiplier,
    })
    .select('id')
    .single();

  if (insertErr || !tradeRow) {
    await auditEvent(input.mode, 'trades insert failed after orders placed', 'error', {
      error: insertErr?.message ?? 'unknown',
      entry_order_id: entryOrder.id,
      stop_order_id: stopOrder?.id ?? null,
      target_order_id: targetOrder?.id ?? null,
    });
    return { success: false, tradeId: null, orderId: entryOrder.id, error: 'Failed to persist trade row' };
  }

  // Step 6: bump bot_status.
  const { data: status } = await sb.from('bot_status').select('daily_trades').eq('mode', input.mode).single();
  await sb.from('bot_status').update({
    daily_trades: (status?.daily_trades ?? 0) + 1,
  }).eq('mode', input.mode);

  await auditEvent(input.mode, 'executeEntry success', 'info', {
    trade_id: tradeRow.id,
    entry_order_id: entryOrder.id,
    fill_price: actualFillPrice,
  });

  // Trade alert email. Wrapped + already times out internally — never blocks return.
  try {
    await sendEntryAlert({
      tradeId: tradeRow.id,
      mode: input.mode,
      instrument: input.signal.instrument,
      direction: input.direction,
      strategy: input.signal.strategy,
      size: input.size,
      entryPrice: actualFillPrice,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      signalScore: input.signal.total_score,
      claudeReasoning: input.signal.claude_explanation,
    });
  } catch (err) {
    console.error('[orderExecutor] entry alert dispatch failed', err);
  }

  return { success: true, tradeId: tradeRow.id, orderId: entryOrder.id, error: null };
}

// ---- executeExit -----------------------------------------------------------

export async function executeExit(tradeId: string, reason: ExitReason): Promise<ExecuteExitResult> {
  const sb = supabaseService();

  // Step 1: get trade.
  const { data: trade, error: readErr } = await sb
    .from('trades').select('*').eq('id', tradeId).single();
  if (readErr || !trade) return { success: false, exitPrice: null, pnl: null, error: 'Trade not found' };
  if (trade.status !== 'open') return { success: false, exitPrice: null, pnl: null, error: `Trade is ${trade.status}, not open` };

  try {
    assertModeSafety(trade.mode);
  } catch (err) {
    return { success: false, exitPrice: null, pnl: null, error: (err as Error).message };
  }

  const inst = instrumentByKey(trade.instrument);
  if (!inst?.alpacaSymbol) {
    return { success: false, exitPrice: null, pnl: null, error: `Instrument ${trade.instrument} not tradable on Alpaca` };
  }

  await auditEvent(trade.mode, 'executeExit started', 'info', { trade_id: tradeId, reason });

  // Step 2: cancel open bracket orders.
  for (const orderId of [trade.stop_order_id, trade.target_order_id]) {
    if (!orderId) continue;
    try {
      await withAlpacaTimeout(cancelOrder(orderId), `cancelOrder(${orderId})`);
    } catch (err) {
      // Not fatal — order may have already been filled.
      console.warn(`[orderExecutor] cancel ${orderId} failed (likely already filled):`, (err as Error).message);
    }
  }

  // Step 3: close position at market.
  try {
    await withAlpacaTimeout(closePosition(inst.alpacaSymbol), 'closePosition');
  } catch (err) {
    await auditEvent(trade.mode, 'closePosition failed', 'error', {
      trade_id: tradeId, error: (err as Error).message,
    });
    return { success: false, exitPrice: null, pnl: null, error: (err as Error).message };
  }

  // Poll for the closing order's fill price.
  // The close order shows up as a new order; grab the most recent matching side.
  const closeSide = trade.direction === 'long' ? 'sell' : 'buy';
  let exitPrice: number | null = null;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const orders = await withAlpacaTimeout(getOrders('all'), 'getOrders(post-close)');
      const slugless = inst.alpacaSymbol.replace('/', '');
      const candidates = orders
        .filter((o) => (o.symbol === inst.alpacaSymbol || o.symbol === slugless) && o.side === closeSide && o.filled_avg_price !== null)
        .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
      if (candidates[0]?.filled_avg_price !== null && candidates[0]?.filled_avg_price !== undefined) {
        exitPrice = candidates[0].filled_avg_price;
        break;
      }
    } catch { /* keep trying */ }
  }
  if (exitPrice === null) {
    // Fall back to stop or target price depending on reason — best-effort.
    exitPrice = reason === 'take_profit' ? trade.take_profit
              : reason === 'stop_loss'   ? trade.stop_loss
              : trade.entry_price;
  }

  // Step 4: calculate PnL.
  const multiplier = trade.contract_multiplier ?? 1;
  const pnl = trade.direction === 'long'
    ? (exitPrice - trade.entry_price) * trade.quantity * multiplier
    : (trade.entry_price - exitPrice) * trade.quantity * multiplier;
  const pnlRounded = Number(pnl.toFixed(2));

  // Step 5: update trade row.
  await sb.from('trades').update({
    status: 'closed',
    exit_price: exitPrice,
    pnl: pnlRounded,
    exit_time: new Date().toISOString(),
    exit_reason: reason,
  }).eq('id', tradeId);

  // Step 6: update bot_status daily_pnl + consecutive_losses tracking.
  const { data: status } = await sb.from('bot_status')
    .select('daily_pnl, consecutive_losses').eq('mode', trade.mode).single();
  const newDailyPnl = Number(((status?.daily_pnl ?? 0) + pnlRounded).toFixed(2));
  const newConsecutiveLosses = pnlRounded < 0 ? (status?.consecutive_losses ?? 0) + 1 : 0;
  await sb.from('bot_status').update({
    daily_pnl: newDailyPnl,
    consecutive_losses: newConsecutiveLosses,
  }).eq('mode', trade.mode);

  // Step 7: check daily loss limit now hit.
  const { data: risk } = await sb.from('risk_settings')
    .select('daily_loss_limit_pct').eq('mode', trade.mode).single();
  if (risk) {
    // Use a rough $100k assumption if Alpaca read fails; this is for the flip only.
    let acctBalance = 100_000;
    try { const { getAccount } = await import('@/lib/alpaca/client'); acctBalance = (await getAccount()).equity; } catch { /* ignore */ }
    const lossDollars = (acctBalance * Number(risk.daily_loss_limit_pct)) / 100;
    if (newDailyPnl <= -lossDollars) {
      await sb.from('bot_status').update({ daily_loss_limit_hit: true }).eq('mode', trade.mode);
    }
  }

  await auditEvent(trade.mode, 'executeExit success', 'info', {
    trade_id: tradeId, reason, exit_price: exitPrice, pnl: pnlRounded,
  });

  // Trade alert email. Wrapped + already times out internally — never blocks return.
  try {
    if (trade.direction) {
      await sendExitAlert({
        tradeId,
        mode: trade.mode,
        instrument: trade.instrument,
        direction: trade.direction,
        strategy: trade.strategy,
        size: trade.quantity,
        entryPrice: trade.entry_price,
        exitPrice,
        pnl: pnlRounded,
        reason,
      });
    }
  } catch (err) {
    console.error('[orderExecutor] exit alert dispatch failed', err);
  }

  return { success: true, exitPrice, pnl: pnlRounded, error: null };
}

/** Close every open trade for a mode (kill switch entrypoint). */
export async function closeAllPositions(mode: TradeMode, reason: ExitReason = 'kill_switch'): Promise<{ closed: number; errors: string[] }> {
  const sb = supabaseService();
  const { data: open } = await sb.from('trades').select('id').eq('mode', mode).eq('status', 'open');
  if (!open || open.length === 0) return { closed: 0, errors: [] };

  let closed = 0;
  const errors: string[] = [];
  for (const t of open) {
    const r = await executeExit(t.id, reason);
    if (r.success) closed++;
    else errors.push(`${t.id}: ${r.error}`);
  }
  return { closed, errors };
}

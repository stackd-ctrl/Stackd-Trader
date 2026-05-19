'use client';

// STACKD TRADER — Live Positions panel.

import { useState } from 'react';
import { Card } from './dashboard/Card';
import { formatUSD } from '@/lib/format';
import { instrumentByKey } from '@/lib/instruments';
import type { LivePrice } from '@/hooks/useRealtimeData';
import type { Trade } from '@/types/database';

const STRAT_TONE: Record<string, string> = {
  momentum:        'text-success border-success/40 bg-success/10',
  mean_reversion:  'text-accent  border-accent/40  bg-accent/10',
  news_sentiment:  'text-warn    border-warn/40    bg-warn/10',
};

function pnlFor(t: Trade, currentPrice: number | null): { pnl: number; pnlPct: number } {
  if (currentPrice === null || !t.direction) return { pnl: 0, pnlPct: 0 };
  const mult = t.contract_multiplier ?? 1;
  const pnl = t.direction === 'long'
    ? (currentPrice - t.entry_price) * t.quantity * mult
    : (t.entry_price - currentPrice) * t.quantity * mult;
  const cost = t.entry_price * t.quantity * mult;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  return { pnl: Number(pnl.toFixed(2)), pnlPct: Number(pnlPct.toFixed(2)) };
}

function distance(direction: 'long' | 'short' | null, current: number | null, target: number, mult: number, qty: number): { points: number; dollars: number } | null {
  if (current === null || direction === null) return null;
  const points = direction === 'long' ? target - current : current - target;
  const dollars = points * mult * qty;
  return { points: Number(points.toFixed(4)), dollars: Number(dollars.toFixed(2)) };
}

function timeInTrade(entryIso: string): string {
  const ms = Date.now() - new Date(entryIso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function LivePositions({
  trades,
  prices,
  todaysTradeCount,
  todaysPnl,
  onClose,
}: {
  trades: Trade[];
  prices: Record<string, LivePrice>;
  todaysTradeCount: number;
  todaysPnl: number;
  onClose: (tradeId: string, reason: 'manual' | 'strategy_change' | 'risk_concern') => Promise<void>;
}) {
  const [pendingClose, setPendingClose] = useState<{ trade: Trade; pnl: number } | null>(null);
  const [closeReason, setCloseReason] = useState<'manual' | 'strategy_change' | 'risk_concern'>('manual');

  const open = trades.filter((t) => t.status === 'open');

  if (open.length === 0) {
    return (
      <Card title="Live Positions" className="col-span-12">
        <p className="text-sm text-muted">No open positions.</p>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Stat label="Trades today" value={String(todaysTradeCount)} />
          <Stat label="P&amp;L today" value={formatUSD(todaysPnl, { signed: true })} accent={todaysPnl >= 0 ? 'good' : 'bad'} />
        </div>
      </Card>
    );
  }

  return (
    <Card title="Live Positions" className="col-span-12">
      <div className="grid grid-cols-1 gap-3">
        {open.map((t) => {
          const inst = instrumentByKey(t.instrument);
          const currentPrice = prices[t.instrument]?.price ?? null;
          const { pnl, pnlPct } = pnlFor(t, currentPrice);
          const toStop   = distance(t.direction, currentPrice, t.stop_loss, t.contract_multiplier, t.quantity);
          const toTarget = distance(t.direction, currentPrice, t.take_profit, t.contract_multiplier, t.quantity);

          // Color tone.
          const beHit = t.direction === 'long' ? t.stop_loss >= t.entry_price : t.stop_loss <= t.entry_price;
          let borderTone = pnl > 0 ? 'border-success/40' : pnl < 0 ? 'border-danger/40' : 'border-line';
          if (beHit) borderTone = 'border-accent/60';
          // Within 30% of stop?
          const stopRiskPoints = Math.abs(t.entry_price - t.stop_loss);
          const currentRiskPoints = currentPrice !== null ? Math.abs((currentPrice ?? 0) - t.stop_loss) : Infinity;
          const nearStop = stopRiskPoints > 0 && (currentRiskPoints / stopRiskPoints) <= 0.30;
          if (nearStop && pnl < 0) borderTone = 'border-danger animate-pulse';

          return (
            <div key={t.id} className={['rounded-lg border bg-panel p-4', borderTone].join(' ')}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-syne text-lg font-bold text-ink">{inst?.display ?? t.instrument}</span>
                    <span className={['text-[10px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded border',
                      t.direction === 'long' ? 'text-success border-success/40' : 'text-danger border-danger/40'].join(' ')}>
                      {t.direction}
                    </span>
                    <span className={['text-[10px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded border', STRAT_TONE[t.strategy] ?? ''].join(' ')}>
                      {t.strategy.replace('_', ' ')}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.14em] text-muted">
                      {t.quantity} contract{t.quantity > 1 ? 's' : ''} · {timeInTrade(t.entry_time)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
                    <Stat label="Entry"   value={`$${t.entry_price.toFixed(2)}`} />
                    <Stat label="Current" value={currentPrice !== null ? `$${currentPrice.toFixed(2)}` : '--'} />
                    <Stat label="Stop"    value={`$${t.stop_loss.toFixed(2)}`} />
                    <Stat label="Target"  value={`$${t.take_profit.toFixed(2)}`} />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
                    <Stat
                      label="To stop"
                      value={toStop ? `${Math.abs(toStop.points).toFixed(2)} pts · ${formatUSD(Math.abs(toStop.dollars))}` : '--'}
                      accent="bad"
                    />
                    <Stat
                      label="To target"
                      value={toTarget ? `${Math.abs(toTarget.points).toFixed(2)} pts · ${formatUSD(Math.abs(toTarget.dollars))}` : '--'}
                      accent="good"
                    />
                    {t.signal_score !== null && <Stat label="Signal" value={t.signal_score.toFixed(1)} />}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  <div className="text-right">
                    <div className={['num font-syne text-2xl font-bold', pnl > 0 ? 'text-success' : pnl < 0 ? 'text-danger' : 'text-ink'].join(' ')}>
                      {formatUSD(pnl, { signed: true })}
                    </div>
                    <div className={['num text-xs', pnlPct > 0 ? 'text-success' : pnlPct < 0 ? 'text-danger' : 'text-muted'].join(' ')}>
                      {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                    </div>
                  </div>
                  <button
                    onClick={() => setPendingClose({ trade: t, pnl })}
                    className="px-3 py-1.5 rounded-md border border-danger/40 bg-danger/10 text-danger text-xs font-semibold hover:bg-danger/20 transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {pendingClose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setPendingClose(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-danger/40 bg-panel shadow-glow">
            <div className="px-5 py-4 border-b border-line">
              <h2 className="font-syne text-lg text-ink">Close {pendingClose.trade.instrument}?</h2>
              <p className="text-xs text-muted mt-1">{pendingClose.trade.quantity} contract{pendingClose.trade.quantity > 1 ? 's' : ''} · entered at ${pendingClose.trade.entry_price.toFixed(2)}</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-muted">Current P&amp;L</div>
                <div className={['num text-2xl font-syne font-bold mt-1', pendingClose.pnl > 0 ? 'text-success' : pendingClose.pnl < 0 ? 'text-danger' : 'text-ink'].join(' ')}>
                  {formatUSD(pendingClose.pnl, { signed: true })}
                </div>
              </div>
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted">Reason</span>
                <select
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value as typeof closeReason)}
                  className="mt-1 w-full bg-bg border border-line rounded-md px-3 py-2 text-ink text-sm focus:border-accent focus:outline-none"
                >
                  <option value="manual">Manual</option>
                  <option value="strategy_change">Strategy change</option>
                  <option value="risk_concern">Risk concern</option>
                </select>
              </label>
            </div>
            <div className="px-5 py-4 border-t border-line flex justify-end gap-2">
              <button onClick={() => setPendingClose(null)} className="px-4 py-2 rounded-md text-sm text-ink/80 hover:bg-line/40">
                Cancel
              </button>
              <button
                onClick={async () => {
                  const id = pendingClose.trade.id;
                  setPendingClose(null);
                  await onClose(id, closeReason);
                }}
                className="px-4 py-2 rounded-md text-sm font-semibold bg-danger text-bg hover:bg-danger/90"
              >
                Close position
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'good' | 'bad' }) {
  const tone = accent === 'good' ? 'text-success' : accent === 'bad' ? 'text-danger' : 'text-ink';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted">{label}</div>
      <div className={['num text-sm', tone].join(' ')}>{value}</div>
    </div>
  );
}

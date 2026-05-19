'use client';

// STACKD TRADER — 30-day paper-trading progress + go-live criteria checklist.

import { useMemo } from 'react';
import { Card } from './dashboard/Card';
import { formatUSD } from '@/lib/format';
import type { BotStatus, Trade } from '@/types/database';

const PAPER_RUN_DAYS = 30;

interface Criterion { label: string; current: number; threshold: number; passes: boolean; format: (n: number) => string }

export function PaperProgress({
  status,
  trades,
  systemUptimePct = 100,
}: {
  status: BotStatus | null;
  trades: Trade[];
  systemUptimePct?: number;
}) {
  const startedAt = status?.paper_started_at ? new Date(status.paper_started_at) : null;

  const { daysElapsed, daysRemaining, progressPct, goLive } = useMemo(() => {
    if (!startedAt) return { daysElapsed: 0, daysRemaining: PAPER_RUN_DAYS, progressPct: 0, goLive: null as Date | null };
    const ms = Date.now() - startedAt.getTime();
    const elapsed = Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
    const remaining = Math.max(0, PAPER_RUN_DAYS - elapsed);
    const pct = Math.min(100, (elapsed / PAPER_RUN_DAYS) * 100);
    const live = new Date(startedAt.getTime() + PAPER_RUN_DAYS * 24 * 60 * 60 * 1000);
    return { daysElapsed: elapsed, daysRemaining: remaining, progressPct: pct, goLive: live };
  }, [startedAt]);

  const closed = useMemo(() => trades.filter((t) => t.status === 'closed'), [trades]);
  const winners = closed.filter((t) => t.pnl > 0);
  const losers  = closed.filter((t) => t.pnl < 0);
  const totalPnl = closed.reduce((s, t) => s + t.pnl, 0);
  const winRate  = closed.length === 0 ? 0 : (winners.length / closed.length) * 100;

  // Average reward / risk.
  const rewardRiskList = closed.map((t) => {
    if (!t.direction) return 0;
    const risk = Math.abs(t.entry_price - t.stop_loss);
    const reward = t.exit_price !== null
      ? Math.abs(t.exit_price - t.entry_price)
      : Math.abs(t.take_profit - t.entry_price);
    return risk > 0 ? reward / risk : 0;
  });
  const avgRR = rewardRiskList.length === 0 ? 0 : rewardRiskList.reduce((a, b) => a + b, 0) / rewardRiskList.length;

  // Max consecutive losses across the run.
  let maxConsecLosses = 0;
  let running = 0;
  const sortedByTime = [...closed].sort((a, b) =>
    new Date(a.exit_time ?? a.entry_time).getTime() - new Date(b.exit_time ?? b.entry_time).getTime(),
  );
  for (const t of sortedByTime) {
    if (t.pnl < 0) { running++; maxConsecLosses = Math.max(maxConsecLosses, running); }
    else running = 0;
  }

  const grossWins   = winners.reduce((s, t) => s + t.pnl, 0);
  const grossLosses = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLosses === 0 ? (grossWins > 0 ? Infinity : 0) : grossWins / grossLosses;

  const criteria: Criterion[] = [
    { label: 'Win rate',              current: winRate,         threshold: 50,  passes: winRate >= 50,       format: (n) => `${n.toFixed(1)}%` },
    { label: 'Avg reward/risk',       current: avgRR,           threshold: 1.6, passes: avgRR >= 1.6,        format: (n) => n.toFixed(2) },
    { label: 'Max consecutive losses',current: maxConsecLosses, threshold: 5,   passes: maxConsecLosses < 5, format: (n) => String(n) },
    { label: 'Total trades',          current: closed.length,   threshold: 150, passes: closed.length >= 150,format: (n) => String(n) },
    { label: 'Profit factor',         current: profitFactor,    threshold: 1.3, passes: profitFactor >= 1.3, format: (n) => Number.isFinite(n) ? n.toFixed(2) : '∞' },
    { label: 'System uptime',         current: systemUptimePct, threshold: 95,  passes: systemUptimePct >= 95, format: (n) => `${n.toFixed(0)}%` },
  ];

  const allMet = criteria.every((c) => c.passes);

  if (!startedAt) {
    return (
      <Card title="Paper trading progress" className="col-span-12">
        <p className="text-sm text-muted">
          Activate paper trading from the Overview banner to start the 30-day run.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Paper trading progress" className="col-span-12">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Countdown */}
        <div className="lg:col-span-2">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted">Day {daysElapsed} of {PAPER_RUN_DAYS}</div>
              <div className="font-syne text-3xl text-ink mt-0.5">{daysRemaining} days remaining</div>
              {goLive && <div className="text-xs text-muted mt-1">Go-live review: {goLive.toLocaleDateString('en-US', { dateStyle: 'long' })}</div>}
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted">Run P&amp;L</div>
              <div className={['num font-syne text-2xl font-bold', totalPnl >= 0 ? 'text-success' : 'text-danger'].join(' ')}>
                {formatUSD(totalPnl, { signed: true })}
              </div>
              <div className="text-xs text-muted">Win rate {winRate.toFixed(1)}%</div>
            </div>
          </div>
          <div className="mt-4 h-3 w-full rounded-full bg-line overflow-hidden">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        {/* Go-live badge */}
        <div className="flex items-center justify-center">
          {allMet ? (
            <div className="text-center px-4 py-3 rounded-lg border border-accent bg-accent/15">
              <div className="font-syne text-xl font-bold text-accent">GO LIVE READY</div>
              <div className="text-xs text-accent/80 mt-1">All 6 criteria passed</div>
            </div>
          ) : (
            <div className="text-center px-4 py-3 rounded-lg border border-warn/40 bg-warn/10">
              <div className="font-syne text-sm font-bold text-warn uppercase tracking-[0.18em]">In progress</div>
              <div className="text-xs text-warn/80 mt-1">{criteria.filter((c) => !c.passes).length} criteria need work</div>
            </div>
          )}
        </div>
      </div>

      {/* Criteria checklist */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 mt-5 pt-4 border-t border-line">
        {criteria.map((c) => (
          <div key={c.label} className={['flex items-center justify-between rounded-md border px-3 py-2',
            c.passes ? 'border-success/40 bg-success/5' : 'border-line bg-bg/40'].join(' ')}>
            <div>
              <div className="text-xs text-ink">{c.label}</div>
              <div className="text-[11px] text-muted">need {c.label === 'Max consecutive losses' ? `below ${c.threshold}` : `above ${c.threshold}`}</div>
            </div>
            <div className="text-right">
              <div className={['num text-sm font-semibold', c.passes ? 'text-success' : 'text-ink'].join(' ')}>
                {c.format(c.current)}
              </div>
              <div className={['text-[10px] uppercase tracking-[0.18em]', c.passes ? 'text-success' : 'text-muted'].join(' ')}>
                {c.passes ? '✓ pass' : 'in progress'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

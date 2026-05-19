'use client';

import { formatUSD } from '@/lib/format';
import { ModeBadge } from './ModeBadge';
import { MarketClock } from './MarketClock';
import type { TradeMode } from '@/types/database';

export function TopBar({
  mode,
  dailyPnl,
  dailyTrades,
  botActive,
  children,
}: {
  mode: TradeMode;
  dailyPnl: number;
  dailyTrades: number;
  botActive: boolean;
  /** Slot for the ModeToggle dropdown / button group. */
  children?: React.ReactNode;
}) {
  const pnlPositive = dailyPnl >= 0;

  return (
    <header className="h-16 border-b border-line bg-panel/60 backdrop-blur flex items-center px-6 gap-6">
      <div className="flex items-center gap-3">
        <span className="font-syne font-bold tracking-[0.18em] text-xl text-ink">
          STACKD
        </span>
        <span className="font-syne font-bold tracking-[0.18em] text-xl text-accent">
          TRADER
        </span>
      </div>

      <ModeBadge mode={mode} />

      <div className="flex-1" />

      <Stat label="Today P&amp;L" value={formatUSD(dailyPnl, { signed: true })} tone={pnlPositive ? 'good' : 'bad'} />
      <Stat label="Trades"     value={String(dailyTrades)} />

      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-line bg-bg/40">
        <span
          className={[
            'h-2 w-2 rounded-full',
            botActive ? 'bg-success animate-pulse' : 'bg-muted',
          ].join(' ')}
        />
        <span className="text-xs uppercase tracking-[0.14em] text-ink/80">
          {botActive ? 'Bot Active' : 'Bot Idle'}
        </span>
      </div>

      <MarketClock />

      {children}
    </header>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
}) {
  const color =
    tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-ink';
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</span>
      <span className={`num text-sm font-semibold ${color}`}>{value}</span>
    </div>
  );
}

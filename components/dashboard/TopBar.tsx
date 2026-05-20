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
    <header className="md:sticky md:top-0 z-30 border-b border-line bg-panel/80 backdrop-blur px-4 md:px-6 py-2.5 md:py-0 md:h-16 flex flex-wrap md:flex-nowrap items-center gap-x-3 gap-y-2 md:gap-6">
      <div className="flex items-center gap-2 md:gap-3">
        <span className="font-syne font-bold tracking-[0.14em] md:tracking-[0.18em] text-lg md:text-xl text-ink">
          STACKD
        </span>
        <span className="font-syne font-bold tracking-[0.14em] md:tracking-[0.18em] text-lg md:text-xl text-accent">
          TRADER
        </span>
      </div>

      <ModeBadge mode={mode} />

      {/* Bot status pill — kept visible on every screen size. */}
      <div className="flex items-center gap-2 px-2.5 py-1 rounded-md border border-line bg-bg/40 ml-auto md:ml-0 md:order-none">
        <span
          className={[
            'h-2 w-2 rounded-full',
            botActive ? 'bg-success animate-pulse' : 'bg-muted',
          ].join(' ')}
        />
        <span className="text-[11px] md:text-xs uppercase tracking-[0.14em] text-ink/80">
          {botActive ? 'Active' : 'Idle'}
        </span>
      </div>

      <div className="hidden md:block flex-1" />

      <Stat label="Today P&amp;L" value={formatUSD(dailyPnl, { signed: true })} tone={pnlPositive ? 'good' : 'bad'} />
      <Stat label="Trades" value={String(dailyTrades)} className="hidden sm:flex" />

      <span className="hidden lg:flex">
        <MarketClock />
      </span>

      {/* Price tiles scroll horizontally on narrow screens instead of overflowing. */}
      <div className="order-last w-full md:order-none md:w-auto overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 md:overflow-visible">
        <div className="flex items-center gap-3 w-max md:w-auto">
          {children}
        </div>
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
  className?: string;
}) {
  const color =
    tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-ink';
  return (
    <div className={['flex flex-col items-end leading-tight', className ?? ''].join(' ')}>
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</span>
      <span className={`num text-sm font-semibold ${color}`}>{value}</span>
    </div>
  );
}

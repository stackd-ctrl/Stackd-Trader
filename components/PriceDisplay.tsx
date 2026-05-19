'use client';

// STACKD TRADER — Top-bar price tiles.
//
// Renders a price chip per instrument, color-coded green/red against day open,
// with subtle pulse on update so the eye catches refreshes.

import { useEffect, useRef, useState } from 'react';
import { instrumentsForMode } from '@/lib/instruments';
import type { LivePrice } from '@/hooks/useRealtimeData';
import type { TradeMode } from '@/types/database';

export function PriceDisplay({
  mode,
  prices,
}: {
  mode: TradeMode;
  prices: Record<string, LivePrice>;
}) {
  const watched = instrumentsForMode(mode);

  return (
    <div className="flex items-center gap-2">
      {watched.map((inst) => (
        <PriceTile key={inst.key} label={inst.display} price={prices[inst.key]} />
      ))}
    </div>
  );
}

function PriceTile({ label, price }: { label: string; price: LivePrice | undefined }) {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevPrice = useRef<number | null>(null);

  useEffect(() => {
    if (!price) return;
    if (prevPrice.current !== null && price.price !== prevPrice.current) {
      setFlash(price.price > prevPrice.current ? 'up' : 'down');
      const id = setTimeout(() => setFlash(null), 400);
      return () => clearTimeout(id);
    }
    prevPrice.current = price.price;
  }, [price]);

  const positive = (price?.changePct ?? 0) >= 0;
  const flashRing =
    flash === 'up'   ? 'ring-1 ring-success/60' :
    flash === 'down' ? 'ring-1 ring-danger/60'  : '';

  return (
    <div
      className={[
        'flex flex-col items-end leading-tight px-2.5 py-1 rounded-md border border-line bg-bg/40',
        'transition',
        flashRing,
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</span>
        <span
          className={[
            'num text-xs font-semibold',
            positive ? 'text-success' : 'text-danger',
          ].join(' ')}
        >
          {price ? (positive ? '+' : '') + price.changePct.toFixed(2) + '%' : '--'}
        </span>
      </div>
      <span className="num text-sm font-semibold text-ink">
        {price ? formatPrice(price.price) : '--'}
      </span>
    </div>
  );
}

function formatPrice(value: number): string {
  if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (value >= 1)    return value.toFixed(2);
  return value.toFixed(4);
}

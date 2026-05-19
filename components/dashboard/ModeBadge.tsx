'use client';

import { MODE_LABELS, type TradeMode } from '@/types/database';

const STYLES: Record<TradeMode, string> = {
  paper:        'bg-success/15 text-success border-success/40',
  live_crypto:  'bg-danger/15  text-danger  border-danger/40',
  live_futures: 'bg-danger/15  text-danger  border-danger/40',
  topstep:      'bg-warn/15    text-warn    border-warn/40',
};

const DOT: Record<TradeMode, string> = {
  paper:        'bg-success',
  live_crypto:  'bg-danger',
  live_futures: 'bg-danger',
  topstep:      'bg-warn',
};

export function ModeBadge({ mode }: { mode: TradeMode }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-2 px-2.5 py-1 rounded-full',
        'border text-xs font-medium uppercase tracking-[0.14em]',
        STYLES[mode],
      ].join(' ')}
    >
      <span className={['h-1.5 w-1.5 rounded-full', DOT[mode]].join(' ')} />
      {MODE_LABELS[mode]}
    </span>
  );
}

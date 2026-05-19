'use client';

import { useEffect, useState } from 'react';
import { MODE_IS_LIVE, MODE_LABELS, type TradeMode } from '@/types/database';

const MODES: TradeMode[] = ['paper', 'live_crypto', 'live_futures', 'topstep'];

const PILL: Record<TradeMode, string> = {
  paper:        'data-[active=true]:bg-success/15 data-[active=true]:text-success data-[active=true]:border-success/50',
  live_crypto:  'data-[active=true]:bg-danger/15  data-[active=true]:text-danger  data-[active=true]:border-danger/50',
  live_futures: 'data-[active=true]:bg-danger/15  data-[active=true]:text-danger  data-[active=true]:border-danger/50',
  topstep:      'data-[active=true]:bg-warn/15    data-[active=true]:text-warn    data-[active=true]:border-warn/50',
};

export function ModeToggle({
  mode,
  onChange,
}: {
  mode: TradeMode;
  onChange: (next: TradeMode) => void;
}) {
  const [pending, setPending] = useState<TradeMode | null>(null);

  function handleSelect(next: TradeMode) {
    if (next === mode) return;
    if (MODE_IS_LIVE[next]) {
      setPending(next);
      return;
    }
    onChange(next);
  }

  return (
    <>
      <div className="flex items-center gap-1 p-1 rounded-lg border border-line bg-bg/40">
        {MODES.map((m) => {
          const isActive = m === mode;
          return (
            <button
              key={m}
              data-active={isActive}
              onClick={() => handleSelect(m)}
              className={[
                'px-3 py-1.5 rounded-md text-xs font-medium tracking-wide',
                'border border-transparent text-ink/70 hover:text-ink transition',
                PILL[m],
              ].join(' ')}
            >
              {MODE_LABELS[m]}
            </button>
          );
        })}
      </div>

      {pending && (
        <LiveConfirmModal
          current={mode}
          target={pending}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const t = pending;
            setPending(null);
            onChange(t);
          }}
        />
      )}
    </>
  );
}

function LiveConfirmModal({
  current,
  target,
  onCancel,
  onConfirm,
}: {
  current: TradeMode;
  target: TradeMode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [text, setText] = useState('');
  const isReady = text.trim().toUpperCase() === 'CONFIRM';

  // ESC to cancel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && isReady) onConfirm();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isReady, onCancel, onConfirm]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-danger/40 bg-panel shadow-glow"
      >
        <div className="px-5 py-4 border-b border-line flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-danger animate-pulse" />
          <h2 className="font-syne text-lg tracking-wide text-ink">
            Switch to {MODE_LABELS[target]}
          </h2>
        </div>

        <div className="px-5 py-5 space-y-4 text-sm text-ink/85 leading-relaxed">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em]">
            <span className="text-muted">{MODE_LABELS[current]}</span>
            <span className="text-muted">&rarr;</span>
            <span className="text-danger font-semibold">{MODE_LABELS[target]}</span>
          </div>
          <p>
            You are about to switch the bot from{' '}
            <span className="font-semibold">{MODE_LABELS[current]}</span> into{' '}
            <span className="text-danger font-semibold">{MODE_LABELS[target]}</span>.
            This mode trades with real money on a live brokerage connection.
          </p>
          <p className="text-ink/70">
            Orders placed in this mode cannot be undone. Make sure your risk settings,
            position sizing, and kill switch are configured the way you want them.
            Cancel returns you to {MODE_LABELS[current]} with no changes.
          </p>

          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted">
              Type CONFIRM to proceed
            </span>
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="CONFIRM"
              className="mt-2 w-full bg-bg border border-line focus:border-accent focus:outline-none rounded-md px-3 py-2 text-ink placeholder:text-muted/60 tracking-[0.18em]"
            />
          </label>
        </div>

        <div className="px-5 py-4 border-t border-line flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-md text-sm text-ink/80 hover:bg-line/40 transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!isReady}
            className={[
              'px-4 py-2 rounded-md text-sm font-semibold transition',
              isReady
                ? 'bg-danger text-bg hover:bg-danger/90'
                : 'bg-line text-muted cursor-not-allowed',
            ].join(' ')}
          >
            Switch to {MODE_LABELS[target]}
          </button>
        </div>
      </div>
    </div>
  );
}

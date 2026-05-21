'use client';

// STACKD TRADER — Manual trade panel.
// Pick instrument + Long/Short, preview ATR-based levels/size, place a real
// paper bracket order. Goes through the same risk guard as the bot (with the
// manual flag, which bypasses only the bot on/off toggle).

import { useMemo, useState } from 'react';
import { instrumentsForMode } from '@/lib/instruments';
import { formatUSD } from '@/lib/format';
import type { TradeDirection, TradeMode } from '@/types/database';

interface Preview {
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  size: number;
  rewardToRisk: number;
  dollarRisk: number;
}

interface ApiResult {
  status: 'executed' | 'skipped' | 'preview';
  reason: string;
  tradeId?: string;
  preview?: Preview;
}

export function ManualTrade({ mode }: { mode: TradeMode }) {
  const tradable = useMemo(
    () => instrumentsForMode(mode).filter((i) => i.alpacaSymbol),
    [mode],
  );

  const [instrument, setInstrument] = useState(tradable[0]?.key ?? 'BTC/USD');
  const [direction, setDirection] = useState<TradeDirection>('long');
  const [tier, setTier] = useState<'full' | 'half'>('full');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'place' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  async function call(dryRun: boolean): Promise<ApiResult | null> {
    try {
      const res = await fetch('/api/execution/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument, direction, mode, tier, dryRun }),
      });
      return (await res.json()) as ApiResult;
    } catch (err) {
      setMsg({ tone: 'bad', text: `Request failed: ${(err as Error).message}` });
      return null;
    }
  }

  async function onPreview() {
    setBusy('preview');
    setMsg(null);
    const r = await call(true);
    setBusy(null);
    if (!r) return;
    if (r.status === 'preview' && r.preview) {
      setPreview(r.preview);
    } else {
      setPreview(null);
      setMsg({ tone: 'bad', text: r.reason });
    }
  }

  async function onPlace() {
    setBusy('place');
    setMsg(null);
    const r = await call(false);
    setBusy(null);
    if (!r) return;
    if (r.status === 'executed') {
      setMsg({ tone: 'good', text: `Order placed. Trade ${r.tradeId?.slice(0, 8)}.` });
      setPreview(null);
    } else {
      setMsg({ tone: 'bad', text: r.reason });
    }
  }

  return (
    <div className="rounded-lg border border-line bg-panel/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-syne font-semibold text-ink">Manual Trade</h3>
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted">{mode}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted">Instrument</span>
          <select
            value={instrument}
            onChange={(e) => { setInstrument(e.target.value); setPreview(null); }}
            className="bg-bg/60 border border-line rounded-md px-3 py-2 text-sm text-ink"
          >
            {tradable.map((i) => (
              <option key={i.key} value={i.key}>{i.display} ({i.key})</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted">Risk</span>
          <select
            value={tier}
            onChange={(e) => { setTier(e.target.value as 'full' | 'half'); setPreview(null); }}
            className="bg-bg/60 border border-line rounded-md px-3 py-2 text-sm text-ink"
          >
            <option value="full">Full (up to 1.5% risk)</option>
            <option value="half">Half (up to 0.75% risk)</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          onClick={() => { setDirection('long'); setPreview(null); }}
          className={[
            'px-3 py-2 rounded-md text-sm font-semibold border transition',
            direction === 'long'
              ? 'bg-success/15 text-success border-success/50'
              : 'border-line text-ink/70 bg-bg/40',
          ].join(' ')}
        >
          Long
        </button>
        <button
          onClick={() => { setDirection('short'); setPreview(null); }}
          className={[
            'px-3 py-2 rounded-md text-sm font-semibold border transition',
            direction === 'short'
              ? 'bg-danger/15 text-danger border-danger/50'
              : 'border-line text-ink/70 bg-bg/40',
          ].join(' ')}
        >
          Short
        </button>
      </div>

      {preview && (
        <div className="mt-3 rounded-md border border-line bg-bg/40 p-3 text-sm">
          <Row label="Entry (market)" value={formatUSD(preview.entryPrice)} />
          <Row label="Stop" value={formatUSD(preview.stopLoss)} tone="bad" />
          <Row label="Target" value={formatUSD(preview.takeProfit)} tone="good" />
          <Row label="Size" value={String(preview.size)} />
          <Row label="R / R" value={preview.rewardToRisk.toFixed(2)} />
          <Row label="Risk" value={formatUSD(preview.dollarRisk)} />
        </div>
      )}

      {msg && (
        <p className={['mt-3 text-sm', msg.tone === 'good' ? 'text-success' : 'text-danger'].join(' ')}>
          {msg.text}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          onClick={onPreview}
          disabled={busy !== null}
          className="px-3 py-2 rounded-md text-sm font-semibold border border-line text-ink/85 bg-bg/40 hover:bg-line/40 transition disabled:opacity-50"
        >
          {busy === 'preview' ? 'Calculating...' : 'Preview'}
        </button>
        <button
          onClick={onPlace}
          disabled={busy !== null}
          className="px-3 py-2 rounded-md text-sm font-semibold border bg-accent/15 text-accent border-accent/40 hover:bg-accent/25 transition disabled:opacity-50"
        >
          {busy === 'place' ? 'Placing...' : 'Place Paper Trade'}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-ink';
  return (
    <div className="flex items-center justify-between py-1 border-b border-line last:border-0">
      <span className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</span>
      <span className={['num text-sm', color].join(' ')}>{value}</span>
    </div>
  );
}

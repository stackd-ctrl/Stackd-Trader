'use client';

// STACKD TRADER — Enhanced signal row.
//
// Shows Claude's enriched analysis. Drop-in replacement for the inline list
// used in Overview; renders one signal per row with expand/collapse.

import { useState } from 'react';
import { formatScore, timeAgo } from '@/lib/format';
import { effectiveAction } from '@/lib/constants';
import type { Signal } from '@/types/database';

const CONFIDENCE_TONE: Record<'high' | 'medium' | 'low', string> = {
  high:   'text-success border-success/40 bg-success/10',
  medium: 'text-warn    border-warn/40    bg-warn/10',
  low:    'text-muted   border-line       bg-bg/40',
};

const SIZING_TONE: Record<'full' | 'half' | 'skip', string> = {
  full: 'text-success', half: 'text-warn', skip: 'text-muted',
};

interface ParsedExplanation {
  summary: string;
  strength: string | null;
  risk: string | null;
}

function parseExplanation(raw: string | null): ParsedExplanation {
  if (!raw) return { summary: '', strength: null, risk: null };
  // Format from lib/claude/signals.ts: "{summary} | Strength: {s} | Risk: {r}"
  const parts = raw.split('|').map((p) => p.trim());
  const summary = parts[0] ?? '';
  const strength = parts.find((p) => p.toLowerCase().startsWith('strength:'))?.replace(/^strength:\s*/i, '') ?? null;
  const risk     = parts.find((p) => p.toLowerCase().startsWith('risk:'))?.replace(/^risk:\s*/i, '')         ?? null;
  return { summary, strength, risk };
}

function inferConfidence(score: number): 'high' | 'medium' | 'low' {
  if (score >= 80) return 'high';
  if (score >= 65) return 'medium';
  return 'low';
}

export function SignalCard({ signal }: { signal: Signal }) {
  const [open, setOpen] = useState(false);
  const exp = parseExplanation(signal.claude_explanation);
  const action = effectiveAction(signal.total_score);
  const confidence = inferConfidence(signal.total_score);

  return (
    <li className="py-3 border-b border-line last:border-b-0">
      <div className="flex items-start gap-4">
        <div className="w-14 shrink-0">
          <div className={['num text-xl font-syne font-bold', action === 'enter' ? 'text-accent' : 'text-muted'].join(' ')}>
            {formatScore(signal.total_score)}
          </div>
          <span className={['mt-1 inline-flex px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-[0.14em]', CONFIDENCE_TONE[confidence]].join(' ')}>
            {confidence}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-ink">{signal.instrument}</span>
            <span className="text-muted">·</span>
            <span className="text-ink/70">{signal.strategy.replace('_', ' ')}</span>
            {signal.direction && (
              <span className={signal.direction === 'long' ? 'text-success text-xs' : 'text-danger text-xs'}>
                {signal.direction.toUpperCase()}
              </span>
            )}
          </div>

          {exp.summary && (
            <p className="text-sm text-ink/85 mt-1 leading-snug">{exp.summary}</p>
          )}

          <div className="flex flex-wrap gap-3 mt-1.5 text-xs">
            {exp.strength && <span className="text-success">+ {exp.strength}</span>}
            {exp.risk     && <span className="text-warn">! {exp.risk}</span>}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={[
            'text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded border',
            action === 'enter' ? 'text-success border-success/40 bg-success/10' : 'text-muted border-line bg-bg/40',
          ].join(' ')}>
            {action}
          </span>
          <span className={['text-[10px] uppercase tracking-[0.18em]', SIZING_TONE[confidence === 'high' ? 'full' : confidence === 'medium' ? 'half' : 'skip']].join(' ')}>
            {confidence === 'high' ? 'full size' : confidence === 'medium' ? 'half size' : 'no size'}
          </span>
          <span className="text-[11px] text-muted">{timeAgo(signal.created_at)}</span>
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[10px] uppercase tracking-[0.18em] text-muted hover:text-accent transition"
          >
            {open ? 'hide' : 'details'}
          </button>
        </div>
      </div>

      {open && (
        <dl className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <Stat label="RSI"           value={signal.rsi?.toFixed(1) ?? '--'} />
          <Stat label="MACD hist"     value={signal.macd_histogram?.toFixed(3) ?? '--'} />
          <Stat label="Vol ratio"     value={signal.volume_ratio?.toFixed(2) ?? '--'} />
          <Stat label="ATR"           value={signal.atr?.toFixed(2) ?? '--'} />
          <Stat label="Sentiment"     value={signal.sentiment_score?.toFixed(1) ?? '--'} />
          <Stat label="Raw score"     value={signal.raw_score?.toFixed(1) ?? '--'} />
          <Stat label="Regime"        value={signal.regime ?? '--'} />
          <Stat label="Key level"     value={signal.key_level_break ? 'broke' : 'no'} />
        </dl>
      )}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</dt>
      <dd className="num text-sm text-ink">{value}</dd>
    </div>
  );
}

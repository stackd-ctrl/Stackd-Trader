'use client';

// STACKD TRADER — Manual cron triggers.
//
// Lives in Settings. Each button POSTs to the matching /api/cron/* endpoint
// with x-manual-trigger: true, which runs the exact same code path Vercel's
// scheduler fires on its cron tick. Last response is rendered inline.

import { useState } from 'react';
import { Card } from './dashboard/Card';

interface Cron {
  key: string;
  path: string;
  label: string;
  description: string;
  schedule: string;
}

const CRONS: Cron[] = [
  {
    key: 'morning',
    path: '/api/cron/morning',
    label: 'Morning Brief',
    description: 'Refresh calendar/news, classify regime, generate brief, activate bot.',
    schedule: '9:00am ET, weekdays',
  },
  {
    key: 'signal-scan',
    path: '/api/cron/signal-scan',
    label: 'Signal Scan',
    description: 'Run technical scorer + Claude sentiment + signal explanation.',
    schedule: 'every minute, weekdays',
  },
  {
    key: 'anomaly-check',
    path: '/api/cron/anomaly-check',
    label: 'Anomaly Check',
    description: 'Snapshot prices + volume, ask Claude to flag risk events.',
    schedule: 'every 15 min, weekdays',
  },
  {
    key: 'evening',
    path: '/api/cron/evening',
    label: 'Evening Report',
    description: 'Aggregate the day, generate report, deactivate bot.',
    schedule: '4:30pm ET, weekdays',
  },
];

type RowState = {
  loading: boolean;
  status: 'idle' | 'ok' | 'error';
  message?: string;
  elapsed_ms?: number;
};

export function CronTriggers() {
  const [state, setState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(CRONS.map((c) => [c.key, { loading: false, status: 'idle' as const }])),
  );

  async function fire(c: Cron) {
    setState((prev) => ({ ...prev, [c.key]: { loading: true, status: 'idle' } }));
    const startedAt = Date.now();
    try {
      const res = await fetch(c.path, {
        method: 'POST',
        headers: {
          'x-manual-trigger': 'true',
          'Content-Type': 'application/json',
        },
      });
      const elapsed = Date.now() - startedAt;
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      setState((prev) => ({
        ...prev,
        [c.key]: {
          loading: false,
          status: res.ok ? 'ok' : 'error',
          message: pretty.slice(0, 800),
          elapsed_ms: elapsed,
        },
      }));
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      setState((prev) => ({
        ...prev,
        [c.key]: {
          loading: false,
          status: 'error',
          message: (err as Error).message,
          elapsed_ms: elapsed,
        },
      }));
    }
  }

  return (
    <Card
      title="Manual cron triggers"
      subtitle="Fires the same code path Vercel's scheduler runs on its cron tick."
      className="col-span-12"
    >
      <div className="space-y-3">
        {CRONS.map((c) => {
          const row = state[c.key];
          const tone =
            row.status === 'ok'    ? 'border-success/40 bg-success/5' :
            row.status === 'error' ? 'border-danger/40  bg-danger/5'  :
                                     'border-line       bg-bg/40';
          return (
            <div key={c.key} className={['rounded-md border p-3', tone].join(' ')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{c.label}</span>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-muted">
                      {c.schedule}
                    </span>
                  </div>
                  <p className="text-xs text-ink/70 mt-1">{c.description}</p>
                </div>
                <button
                  onClick={() => fire(c)}
                  disabled={row.loading}
                  className={[
                    'shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold border transition',
                    row.loading
                      ? 'bg-line text-muted border-line cursor-wait'
                      : 'bg-accent/15 text-accent border-accent/40 hover:bg-accent/25',
                  ].join(' ')}
                >
                  {row.loading ? 'Running…' : 'Trigger'}
                </button>
              </div>

              {row.message && (
                <details className="mt-2">
                  <summary className="text-[10px] uppercase tracking-[0.18em] text-muted cursor-pointer">
                    {row.status === 'ok' ? 'Result' : 'Error'}
                    {row.elapsed_ms !== undefined && ` · ${row.elapsed_ms}ms`}
                  </summary>
                  <pre className="num text-[11px] mt-1.5 p-2 rounded bg-bg/80 border border-line text-ink/85 whitespace-pre-wrap overflow-x-auto">
                    {row.message}
                  </pre>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

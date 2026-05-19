'use client';

// STACKD TRADER — Claude usage / cost tracker.
//
// Pulls today's calls from /api/claude-usage. Lives in Settings.

import { useEffect, useState } from 'react';
import { Card } from './dashboard/Card';
import { formatUSD } from '@/lib/format';
import type { ClaudeCallType } from '@/types/database';

interface UsageBreakdownRow {
  call_type: ClaudeCallType;
  count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface UsageSummary {
  today: {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  };
  by_type: UsageBreakdownRow[];
  monthly_projection_usd: number;
}

const TYPE_LABEL: Record<ClaudeCallType, string> = {
  sentiment:        'News Sentiment',
  signal_explain:   'Signal Analysis',
  morning_brief:    'Morning Brief',
  evening_report:   'Evening Report',
  anomaly_check:    'Anomaly Check',
  regime_classify:  'Regime Classify',
};

export function ClaudeUsage() {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/claude-usage', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as UsageSummary;
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    void load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <Card title="Claude API Usage // Today" className="col-span-12 lg:col-span-6">
      {error && (
        <p className="text-xs text-danger">Failed to load usage: {error}</p>
      )}
      {!data ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Calls"           value={String(data.today.calls)} />
            <Stat label="Input tokens"    value={data.today.input_tokens.toLocaleString('en-US')} />
            <Stat label="Output tokens"   value={data.today.output_tokens.toLocaleString('en-US')} />
            <Stat label="Cost"            value={formatUSD(data.today.cost_usd)} accent />
          </div>

          <div className="mt-4 border-t border-line pt-3">
            <h4 className="text-[10px] uppercase tracking-[0.22em] text-muted mb-2">By call type</h4>
            <table className="w-full text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="text-left font-normal pb-1">Type</th>
                  <th className="text-right font-normal pb-1">Calls</th>
                  <th className="text-right font-normal pb-1">Tokens</th>
                  <th className="text-right font-normal pb-1">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.by_type.length === 0 ? (
                  <tr><td colSpan={4} className="text-muted py-2">No calls yet today.</td></tr>
                ) : (
                  data.by_type.map((row) => (
                    <tr key={row.call_type}>
                      <td className="py-1.5 text-ink">{TYPE_LABEL[row.call_type] ?? row.call_type}</td>
                      <td className="py-1.5 text-right num">{row.count}</td>
                      <td className="py-1.5 text-right num text-ink/70">
                        {(row.input_tokens + row.output_tokens).toLocaleString('en-US')}
                      </td>
                      <td className="py-1.5 text-right num text-accent">{formatUSD(row.cost_usd)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted mt-3">
            Monthly projection at current pace: <span className="text-ink">{formatUSD(data.monthly_projection_usd)}</span>
          </p>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted">{label}</div>
      <div className={['num text-lg font-semibold mt-0.5', accent ? 'text-accent' : 'text-ink'].join(' ')}>
        {value}
      </div>
    </div>
  );
}

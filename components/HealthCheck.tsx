'use client';

// STACKD TRADER — Health check dashboard.

import { useCallback, useEffect, useState } from 'react';
import { Card } from './dashboard/Card';
import { formatUSD } from '@/lib/format';

interface HealthReport {
  timestamp: string;
  overall_health: 'healthy' | 'degraded' | 'critical';
  checks: {
    supabase: {
      connected: boolean;
      tables: Record<string, boolean>;
      error: string | null;
    };
    alpaca: { connected: boolean; mode: string; balance: number | null; error: string | null };
    polygon: { connected: boolean; sample_price: number | null; error: string | null };
    anthropic: { connected: boolean; error: string | null };
    environment: Record<string, boolean>;
    bot_status: { is_active: boolean; regime: string; daily_pnl: number; daily_trades: number } | null;
  };
}

// Exact hex from spec — used inline so the colors match without adding to tailwind config.
const COLOR = { healthy: '#22c55e', degraded: '#f97316', critical: '#ef4444' } as const;

function overallStyle(health: HealthReport['overall_health']) {
  return { color: COLOR[health], borderColor: `${COLOR[health]}66`, backgroundColor: `${COLOR[health]}15` };
}

function dotStyle(connected: boolean | undefined) {
  return { backgroundColor: connected ? COLOR.healthy : COLOR.critical };
}

const ENV_LABELS: Record<string, string> = {
  supabase_url:          'NEXT_PUBLIC_SUPABASE_URL',
  supabase_anon_key:     'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  supabase_service_role: 'SUPABASE_SERVICE_ROLE_KEY',
  alpaca_paper_key:      'ALPACA_API_KEY_ID',
  alpaca_paper_secret:   'ALPACA_API_SECRET_KEY',
  alpaca_paper_base_url: 'ALPACA_PAPER_BASE_URL',
  polygon_key:           'POLYGON_API_KEY',
  anthropic_key:         'ANTHROPIC_API_KEY',
  trading_mode:          'TRADING_MODE',
};

export function HealthCheck() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/test', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as HealthReport;
      setReport(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <Card title="Health check" className="col-span-12">
      {/* Header: overall badge + refresh */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {report ? (
            <span
              style={overallStyle(report.overall_health)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border font-syne text-sm uppercase tracking-[0.18em] font-semibold"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLOR[report.overall_health] }} />
              {report.overall_health}
            </span>
          ) : (
            <span className="text-sm text-muted">Loading…</span>
          )}
          {report && (
            <span className="text-xs text-muted">
              Last checked {new Date(report.timestamp).toLocaleString('en-US')}
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="px-3 py-1.5 rounded-md text-xs font-semibold border border-accent/40 bg-accent/15 text-accent hover:bg-accent/25 transition disabled:opacity-50"
        >
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <p className="mt-3 px-3 py-2 rounded-md border border-danger/40 bg-danger/10 text-danger text-xs">
          Health endpoint failed: {error}
        </p>
      )}

      {report && (
        <>
          {/* Service cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
            <ServiceCard
              name="Supabase"
              connected={report.checks.supabase.connected}
              error={report.checks.supabase.error}
              detail={`Tables: ${Object.values(report.checks.supabase.tables).filter(Boolean).length}/5`}
            />
            <ServiceCard
              name="Alpaca"
              connected={report.checks.alpaca.connected}
              error={report.checks.alpaca.error}
              detail={
                report.checks.alpaca.connected
                  ? `${report.checks.alpaca.mode} · ${formatUSD(report.checks.alpaca.balance ?? 0)}`
                  : report.checks.alpaca.mode
              }
            />
            <ServiceCard
              name="Polygon"
              connected={report.checks.polygon.connected}
              error={report.checks.polygon.error}
              detail={
                report.checks.polygon.connected && report.checks.polygon.sample_price
                  ? `BTC ${formatUSD(report.checks.polygon.sample_price)}`
                  : 'no price'
              }
            />
            <ServiceCard
              name="Anthropic"
              connected={report.checks.anthropic.connected}
              error={report.checks.anthropic.error}
              detail={report.checks.anthropic.connected ? 'HEALTHY ack received' : 'no response'}
            />
          </div>

          {/* Supabase tables breakdown */}
          <div className="mt-4 border-t border-line pt-3">
            <h4 className="text-[10px] uppercase tracking-[0.22em] text-muted mb-2">Supabase tables</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {Object.entries(report.checks.supabase.tables).map(([t, ok]) => (
                <Row key={t} label={t} ok={ok} />
              ))}
            </div>
          </div>

          {/* Environment variables */}
          <div className="mt-4 border-t border-line pt-3">
            <h4 className="text-[10px] uppercase tracking-[0.22em] text-muted mb-2">Environment variables</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {Object.entries(report.checks.environment).map(([k, ok]) => (
                <Row key={k} label={ENV_LABELS[k] ?? k} ok={ok} />
              ))}
            </div>
          </div>

          {/* Bot status */}
          <div className="mt-4 border-t border-line pt-3">
            <h4 className="text-[10px] uppercase tracking-[0.22em] text-muted mb-2">Bot status (paper)</h4>
            {report.checks.bot_status ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <Stat
                  label="Active"
                  value={report.checks.bot_status.is_active ? 'YES' : 'NO'}
                  tone={report.checks.bot_status.is_active ? 'good' : 'muted'}
                />
                <Stat label="Regime"      value={report.checks.bot_status.regime} />
                <Stat
                  label="Daily P&amp;L"
                  value={formatUSD(report.checks.bot_status.daily_pnl, { signed: true })}
                  tone={report.checks.bot_status.daily_pnl >= 0 ? 'good' : 'bad'}
                />
                <Stat label="Trades today" value={String(report.checks.bot_status.daily_trades)} />
              </div>
            ) : (
              <p className="text-xs text-muted">No bot_status row available.</p>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function ServiceCard({ name, connected, error, detail }: { name: string; connected: boolean; error: string | null; detail: string }) {
  const borderColor = `${connected ? COLOR.healthy : COLOR.critical}66`;
  const bg = `${connected ? COLOR.healthy : COLOR.critical}15`;
  return (
    <div className="rounded-lg border p-3" style={{ borderColor, backgroundColor: bg }}>
      <div className="flex items-center justify-between">
        <span className="font-syne text-sm font-semibold text-ink">{name}</span>
        <span className="h-2 w-2 rounded-full" style={dotStyle(connected)} />
      </div>
      <p className="text-xs mt-1" style={{ color: connected ? COLOR.healthy : COLOR.critical }}>
        {connected ? 'connected' : 'offline'}
      </p>
      <p className="text-[11px] text-ink/70 mt-1 truncate">{detail}</p>
      {error && !connected && (
        <p className="text-[10px] mt-1 break-words" style={{ color: COLOR.critical }} title={error}>
          {error.slice(0, 120)}{error.length > 120 ? '…' : ''}
        </p>
      )}
    </div>
  );
}

function Row({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs px-2 py-1 rounded bg-bg/40 border border-line">
      <span className="text-ink/80 truncate mr-2 font-mono text-[11px]">{label}</span>
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={dotStyle(ok)} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'muted' }) {
  const color =
    tone === 'good'  ? COLOR.healthy :
    tone === 'bad'   ? COLOR.critical :
    tone === 'muted' ? '#8A867F' : '#F5F0E8';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="num text-sm font-semibold mt-0.5" style={{ color }}>{value}</div>
    </div>
  );
}

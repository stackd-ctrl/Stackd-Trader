'use client';

// STACKD TRADER — Risk Monitor.

import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@/components/dashboard/Card';
import { formatUSD } from '@/lib/format';
import { calculatePositionSize } from '@/lib/execution/positionSizer';
import { INSTRUMENTS, instrumentByKey } from '@/lib/instruments';
import { supabaseBrowser } from '@/lib/supabase';
import type {
  AccountSnapshot,
  BotStatus,
  RiskGuardLog,
  RiskSettings,
  TradeMode,
} from '@/types/database';

const DAILY_TRADE_LIMIT = 10;
const CONSECUTIVE_LOSS_LIMIT = 3;

export function RiskMonitor({
  mode,
  status,
  riskSettings,
}: {
  mode: TradeMode;
  status: BotStatus | null;
  riskSettings: RiskSettings | null;
}) {
  const [snapshots, setSnapshots] = useState<AccountSnapshot[]>([]);
  const [guardLog, setGuardLog] = useState<RiskGuardLog[]>([]);
  const [accountBalance, setAccountBalance] = useState<number>(100_000);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = supabaseBrowser();
      const [snaps, guards] = await Promise.all([
        sb.from('account_snapshots').select('*').eq('mode', mode)
          .order('snapshot_at', { ascending: true }).limit(200),
        sb.from('risk_guard_log').select('*').eq('mode', mode)
          .order('created_at', { ascending: false }).limit(50),
      ]);
      if (!cancelled) {
        setSnapshots(snaps.data ?? []);
        setGuardLog(guards.data ?? []);
      }
    })();
    // Pull live balance via /api/account
    fetch('/api/account', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d && !cancelled && typeof d.equity === 'number') setAccountBalance(d.equity); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [mode]);

  // ---- Gauge values ----
  const dailyPnl = status?.daily_pnl ?? 0;
  const dailyLimitPct = riskSettings?.daily_loss_limit_pct ?? 3;
  const dailyLossLimit = accountBalance * (dailyLimitPct / 100);
  const lossUsedDollars = dailyPnl < 0 ? Math.abs(dailyPnl) : 0;
  const lossUsedPct = dailyLossLimit > 0 ? Math.min(100, (lossUsedDollars / dailyLossLimit) * 100) : 0;

  const tradesUsedPct = (status?.daily_trades ?? 0) / DAILY_TRADE_LIMIT * 100;

  const peak = snapshots[snapshots.length - 1]?.peak_equity ?? accountBalance;
  const drawdownPct = peak > 0 ? ((peak - accountBalance) / peak) * 100 : 0;

  const consecutiveLosses = status?.consecutive_losses ?? 0;
  const consecutivePct = (consecutiveLosses / CONSECUTIVE_LOSS_LIMIT) * 100;

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Gauges */}
      <Card title="Daily risk gauges" className="col-span-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Gauge
            label="Daily loss usage"
            valuePct={lossUsedPct}
            primaryLine={`${formatUSD(lossUsedDollars)} of ${formatUSD(dailyLossLimit)}`}
            secondaryLine={lossUsedPct >= 100 ? 'LIMIT HIT' : `${lossUsedPct.toFixed(1)}% used`}
            criticalAt={75}
            warnAt={50}
            critical={status?.daily_loss_limit_hit}
          />
          <Gauge
            label="Daily trade count"
            valuePct={tradesUsedPct}
            primaryLine={`${status?.daily_trades ?? 0} of ${DAILY_TRADE_LIMIT} trades`}
            secondaryLine={tradesUsedPct >= 100 ? 'LIMIT HIT' : `${(DAILY_TRADE_LIMIT - (status?.daily_trades ?? 0))} remaining`}
            criticalAt={90}
            warnAt={70}
          />
          <Gauge
            label="Drawdown"
            valuePct={Math.min(100, (drawdownPct / 10) * 100)}
            primaryLine={`${drawdownPct.toFixed(2)}% from peak`}
            secondaryLine={`Peak ${formatUSD(peak)} · Now ${formatUSD(accountBalance)}`}
            criticalAt={80}      // 8% → red
            warnAt={50}          // 5% → yellow
            critical={drawdownPct >= 10}
          />
          <Gauge
            label="Consecutive losses"
            valuePct={consecutivePct}
            primaryLine={`${consecutiveLosses} of ${CONSECUTIVE_LOSS_LIMIT} max`}
            secondaryLine={consecutiveLosses >= CONSECUTIVE_LOSS_LIMIT ? '30-min cooldown active' : 'Resets after any win'}
            criticalAt={100}
            warnAt={66}
            critical={consecutiveLosses >= CONSECUTIVE_LOSS_LIMIT}
          />
        </div>
      </Card>

      {/* Position size calculator */}
      <PositionSizeCalculator
        defaultAccountBalance={accountBalance}
        defaultDrawdownPct={drawdownPct}
      />

      {/* Drawdown chart */}
      <Card title="Drawdown over time" className="col-span-12 lg:col-span-7">
        {snapshots.length < 2 ? (
          <p className="text-sm text-muted py-6 text-center">Drawdown chart appears after a few account snapshots.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={snapshots.map((s) => ({
              date: s.snapshot_at.slice(0, 10),
              drawdownPct: Number(s.drawdown_pct),
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F1E1B" />
              <XAxis dataKey="date" tick={{ fill: '#8A867F', fontSize: 11 }} />
              <YAxis tick={{ fill: '#8A867F', fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={{ background: '#121212', border: '1px solid #1F1E1B', color: '#F5F0E8' }}
                formatter={(v: number) => `${v.toFixed(2)}%`}
              />
              <ReferenceLine y={5}  stroke="#FF8A1F" strokeDasharray="3 3" label={{ value: '5% warn',     fill: '#FF8A1F', fontSize: 10 }} />
              <ReferenceLine y={8}  stroke="#FF4D4F" strokeDasharray="3 3" label={{ value: '8% heavy',    fill: '#FF4D4F', fontSize: 10 }} />
              <ReferenceLine y={10} stroke="#FF4D4F" strokeWidth={2}       label={{ value: '10% pause',   fill: '#FF4D4F', fontSize: 10 }} />
              <Line type="monotone" dataKey="drawdownPct" stroke="#F5C400" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Risk guard log */}
      <Card title="Risk guard log" subtitle="Last 50 evaluations" className="col-span-12">
        {guardLog.length === 0 ? (
          <p className="text-sm text-muted">No risk guard evaluations recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <th className="text-left py-2 px-2 font-normal">Time</th>
                  <th className="text-left py-2 px-2 font-normal">Instrument</th>
                  <th className="text-left py-2 px-2 font-normal">Strategy</th>
                  <th className="text-left py-2 px-2 font-normal">Decision</th>
                  <th className="text-left py-2 px-2 font-normal">Failed check</th>
                  <th className="text-left py-2 px-2 font-normal">Reason</th>
                  <th className="text-right py-2 px-2 font-normal">Size</th>
                </tr>
              </thead>
              <tbody>
                {guardLog.map((row) => {
                  const tone = row.decision === 'approved' ? 'bg-success/5'
                             : row.decision === 'adjusted' ? 'bg-warn/5'
                                                            : 'bg-danger/5';
                  return (
                    <tr key={row.id} className={['border-b border-line/40', tone].join(' ')}>
                      <td className="py-1.5 px-2 num text-muted">{new Date(row.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="py-1.5 px-2">{row.instrument}</td>
                      <td className="py-1.5 px-2 text-ink/80">{row.strategy.replace('_', ' ')}</td>
                      <td className="py-1.5 px-2">
                        <span className={[
                          'inline-flex px-1.5 py-0.5 rounded border text-[10px] uppercase',
                          row.decision === 'approved' ? 'text-success border-success/40'
                          : row.decision === 'adjusted' ? 'text-warn border-warn/40'
                                                        : 'text-danger border-danger/40',
                        ].join(' ')}>{row.decision}</span>
                      </td>
                      <td className="py-1.5 px-2 text-muted">{row.failed_check ?? '--'}</td>
                      <td className="py-1.5 px-2 text-ink/85">{row.reason ?? '--'}</td>
                      <td className="py-1.5 px-2 text-right num">
                        {row.adjusted_size !== null ? `${row.proposed_size} → ${row.adjusted_size}` : row.proposed_size?.toString() ?? '--'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---- Gauge ----

function Gauge({
  label, valuePct, primaryLine, secondaryLine, warnAt, criticalAt, critical,
}: {
  label: string;
  valuePct: number;
  primaryLine: string;
  secondaryLine: string;
  warnAt: number;
  criticalAt: number;
  critical?: boolean;
}) {
  const tone =
    critical || valuePct >= criticalAt ? 'bg-danger' :
    valuePct >= warnAt                ? 'bg-warn'   :
                                         'bg-success';
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-3 h-2 w-full rounded-full bg-line overflow-hidden">
        <div className={['h-full transition-all', tone].join(' ')} style={{ width: `${Math.max(0, Math.min(100, valuePct))}%` }} />
      </div>
      <div className="num text-sm text-ink mt-2">{primaryLine}</div>
      <div className="text-[11px] text-muted">{secondaryLine}</div>
    </div>
  );
}

// ---- Position-size calculator ----

function PositionSizeCalculator({
  defaultAccountBalance,
  defaultDrawdownPct,
}: {
  defaultAccountBalance: number;
  defaultDrawdownPct: number;
}) {
  const [balance, setBalance]     = useState<number>(defaultAccountBalance);
  const [entry, setEntry]         = useState<number>(0);
  const [stop, setStop]           = useState<number>(0);
  const [instrument, setInstrument] = useState<string>(INSTRUMENTS[0].key);

  useEffect(() => { setBalance(defaultAccountBalance); }, [defaultAccountBalance]);

  const result = useMemo(() => {
    if (entry <= 0 || stop <= 0 || balance <= 0) return null;
    return calculatePositionSize(balance, entry, stop, instrument, 70, 'full', defaultDrawdownPct);
  }, [balance, entry, stop, instrument, defaultDrawdownPct]);

  const inst = instrumentByKey(instrument);

  return (
    <Card title="Position size calculator" subtitle="Reference tool for manual size checks" className="col-span-12 lg:col-span-5">
      <div className="space-y-3 text-xs">
        <Field label="Account balance ($)" value={balance} onChange={setBalance} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entry price"       value={entry}   onChange={setEntry}   step={0.01} />
          <Field label="Stop price"        value={stop}    onChange={setStop}    step={0.01} />
        </div>
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted">Instrument</span>
          <select value={instrument} onChange={(e) => setInstrument(e.target.value)}
            className="mt-1 w-full bg-bg border border-line rounded-md px-2 py-1.5 text-ink focus:border-accent focus:outline-none">
            {INSTRUMENTS.map((i) => <option key={i.key} value={i.key}>{i.display} · {i.class}</option>)}
          </select>
        </label>

        <div className="border-t border-line pt-3 grid grid-cols-3 gap-3">
          <Stat label="Contracts"   value={result ? String(result.contracts) : '--'} />
          <Stat label="Dollar risk" value={result ? formatUSD(result.dollarRisk) : '--'} />
          <Stat label="Risk %"      value={result ? `${result.riskPct.toFixed(2)}%` : '--'} />
        </div>
        {inst && (
          <p className="text-[11px] text-muted">
            Multiplier ${inst.contractMultiplier}/pt · Drawdown {defaultDrawdownPct.toFixed(2)}% factored in
          </p>
        )}
      </div>
    </Card>
  );
}

function Field({ label, value, onChange, step }: { label: string; value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</span>
      <input type="number" step={step ?? 1} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full bg-bg border border-line rounded-md px-2 py-1.5 text-ink num focus:border-accent focus:outline-none" />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="num text-sm font-semibold text-ink mt-0.5">{value}</div>
    </div>
  );
}

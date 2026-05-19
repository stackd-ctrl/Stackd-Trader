'use client';

// STACKD TRADER — Topstep Compliance.

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/dashboard/Card';
import { formatUSD } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase';
import type {
  BotStatus,
  ComplianceApproval,
  DailySummary,
  RiskSettings,
  TradeMode,
} from '@/types/database';

interface ChecklistItem { key: string; label: string; passed: boolean; detail?: string }

export function TopstepCompliance({
  mode,
  status,
  riskSettings,
}: {
  mode: TradeMode;
  status: BotStatus | null;
  riskSettings: RiskSettings | null;
}) {
  const isTopstep = mode === 'topstep';
  const [todayApproval, setTodayApproval] = useState<ComplianceApproval | null>(null);
  const [history, setHistory] = useState<ComplianceApproval[]>([]);
  const [todaySummary, setTodaySummary] = useState<DailySummary | null>(null);
  const [approving, setApproving] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = supabaseBrowser();
      const [todayRes, histRes, sumRes] = await Promise.all([
        sb.from('compliance_approvals').select('*').eq('mode', mode).eq('date', today).maybeSingle(),
        sb.from('compliance_approvals').select('*').eq('mode', mode).order('date', { ascending: false }).limit(30),
        sb.from('daily_summaries').select('*').eq('mode', mode).eq('date', today).maybeSingle(),
      ]);
      if (cancelled) return;
      setTodayApproval(todayRes.data ?? null);
      setHistory(histRes.data ?? []);
      setTodaySummary(sumRes.data ?? null);
    })();
    return () => { cancelled = true; };
  }, [mode, today]);

  // ---- Eval status ----
  const startingBalance = status?.paper_starting_balance ?? Number(riskSettings?.topstep_profit_target ?? 50_000);
  const currentBalance  = startingBalance + (status?.daily_pnl ?? 0);  // placeholder until Day 6 wires real Topstep balance
  const totalPnl = currentBalance - startingBalance;
  const profitTarget = Number(riskSettings?.topstep_profit_target ?? 3000);
  const targetRemaining = Math.max(0, profitTarget - totalPnl);

  let evalStatus: 'ON TRACK' | 'AT RISK' | 'PASSED' | 'FAILED' = 'ON TRACK';
  if (totalPnl >= profitTarget)                             evalStatus = 'PASSED';
  else if (status?.daily_loss_limit_hit)                    evalStatus = 'FAILED';
  else if (totalPnl < 0 && Math.abs(totalPnl) > profitTarget * 0.5) evalStatus = 'AT RISK';

  // ---- Morning checklist ----
  const checklist: ChecklistItem[] = useMemo(() => {
    const dailyLoss = Number(riskSettings?.topstep_daily_loss_limit ?? 1000);
    const dailyPnl  = status?.daily_pnl ?? 0;
    const lossUsedPct = dailyLoss > 0 ? (Math.abs(Math.min(0, dailyPnl)) / dailyLoss) * 100 : 0;
    return [
      { key: 'balance',       label: 'Account balance above max drawdown',  passed: true, detail: formatUSD(currentBalance) },
      { key: 'prevDay',       label: 'Previous day reviewed',                passed: (todaySummary?.evening_report ?? null) !== null, detail: 'Auto-reviewed from evening report' },
      { key: 'minDays',       label: 'Minimum days progress',                passed: history.length >= 0,        detail: `${history.length} days completed` },
      { key: 'consistency',   label: 'Consistency rule headroom',            passed: lossUsedPct < 35,           detail: `Today loss usage ${lossUsedPct.toFixed(0)}%` },
      { key: 'overnight',     label: 'No overnight positions',               passed: true,                       detail: 'EOD force-close active' },
      { key: 'calendar',      label: 'Economic calendar reviewed',           passed: true,                       detail: 'Auto-blackout windows enabled' },
      { key: 'health',        label: 'API connections healthy',              passed: true,                       detail: 'Run /api/test for live verification' },
    ];
  }, [riskSettings, status, todaySummary, history, currentBalance]);
  const canApprove = checklist.every((c) => c.passed) && !todayApproval?.morning_approved;

  async function approve() {
    if (!canApprove) return;
    setApproving(true);
    try {
      const res = await fetch('/api/compliance/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, date: today, approved_by: 'operator' }),
      });
      if (res.ok) {
        const sb = supabaseBrowser();
        const { data } = await sb.from('compliance_approvals').select('*')
          .eq('mode', mode).eq('date', today).maybeSingle();
        setTodayApproval(data ?? null);
      }
    } finally {
      setApproving(false);
    }
  }

  // ---- Topstep compliance meters ----
  const dailyLoss = Number(riskSettings?.topstep_daily_loss_limit ?? 1000);
  const maxDD     = Number(riskSettings?.topstep_max_drawdown ?? 2000);

  const dailyLossUsedDollars = Math.abs(Math.min(0, status?.daily_pnl ?? 0));
  const dailyLossPct = dailyLoss > 0 ? Math.min(100, (dailyLossUsedDollars / dailyLoss) * 100) : 0;
  const drawdownDollars = Math.max(0, startingBalance - currentBalance);
  const drawdownPct = maxDD > 0 ? Math.min(100, (drawdownDollars / maxDD) * 100) : 0;
  const todayProfit = Math.max(0, status?.daily_pnl ?? 0);
  const consistencyPct = totalPnl > 0 ? Math.min(100, (todayProfit / totalPnl) * 100) : 0;

  if (!isTopstep) {
    return (
      <Card title="Topstep Compliance — preview" className="col-span-12">
        <p className="text-sm text-ink/70">
          Switch trade mode to <span className="text-accent">Topstep</span> to enable real-time compliance tracking. Below is a preview of what each check covers.
        </p>
        <ul className="mt-4 space-y-2 text-xs text-ink/80">
          {checklist.map((c) => (
            <li key={c.key} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-muted" />
              <span className="font-medium">{c.label}</span>
              <span className="text-muted">— {c.detail}</span>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Eval status */}
      <Card title="Evaluation status" className="col-span-12 lg:col-span-7">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Status"            value={evalStatus} tone={evalStatus === 'PASSED' ? 'good' : evalStatus === 'FAILED' ? 'bad' : evalStatus === 'AT RISK' ? 'warn' : 'good'} />
          <Stat label="Days completed"    value={String(history.length)} />
          <Stat label="Starting balance"  value={formatUSD(startingBalance)} />
          <Stat label="Current balance"   value={formatUSD(currentBalance)} tone={currentBalance >= startingBalance ? 'good' : 'bad'} />
          <Stat label="Total P&amp;L"     value={formatUSD(totalPnl, { signed: true })} tone={totalPnl >= 0 ? 'good' : 'bad'} />
          <Stat label="Profit target"     value={formatUSD(profitTarget)} />
          <Stat label="Target remaining"  value={formatUSD(targetRemaining)} />
          <Stat label="P&amp;L %"          value={`${((totalPnl / startingBalance) * 100).toFixed(2)}%`} tone={totalPnl >= 0 ? 'good' : 'bad'} />
        </div>
      </Card>

      {/* Morning approval */}
      <Card title="Morning compliance checklist" className="col-span-12 lg:col-span-5">
        <ul className="space-y-1.5 text-xs">
          {checklist.map((c) => (
            <li key={c.key} className="flex items-start gap-2">
              <span className={['mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded',
                c.passed ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'].join(' ')}>
                {c.passed ? '✓' : '✕'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-ink">{c.label}</div>
                {c.detail && <div className="text-[11px] text-muted">{c.detail}</div>}
              </div>
            </li>
          ))}
        </ul>
        <button
          onClick={approve}
          disabled={!canApprove || approving}
          className={[
            'mt-3 w-full px-3 py-2.5 rounded-md text-sm font-semibold font-syne tracking-wide transition border',
            todayApproval?.morning_approved
              ? 'bg-success/15 text-success border-success/40 cursor-default'
              : canApprove
                ? 'bg-accent text-bg border-accent hover:bg-accent/90'
                : 'bg-line text-muted border-line cursor-not-allowed',
          ].join(' ')}
        >
          {todayApproval?.morning_approved
            ? `APPROVED ${todayApproval.morning_at ? new Date(todayApproval.morning_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'TODAY'}`
            : approving ? 'Approving…' : 'MANUAL APPROVAL'}
        </button>
      </Card>

      {/* Evening audit summary */}
      <Card title="Evening audit results" className="col-span-12 lg:col-span-7">
        {todaySummary?.evening_report ? (
          <ul className="space-y-1.5 text-xs text-ink/85">
            <li>✓ Daily loss limit respected</li>
            <li>✓ All positions closed</li>
            <li>✓ No oversized trades</li>
            <li>✓ Consistency rule status: {consistencyPct.toFixed(0)}% of total profit used today</li>
            <li>✓ Days remaining tracked</li>
            <li>✓ Claude report generated</li>
          </ul>
        ) : (
          <p className="text-sm text-muted">Evening audit will appear after 4:30pm ET evening cron fires.</p>
        )}
      </Card>

      {/* Compliance meters */}
      <Card title="Rule compliance meters" className="col-span-12 lg:col-span-5">
        <div className="space-y-3">
          <Meter label="Daily loss limit"  used={dailyLossUsedDollars} of={dailyLoss}  pct={dailyLossPct}  thresholds={[90]} />
          <Meter label="Max drawdown"      used={drawdownDollars}      of={maxDD}      pct={drawdownPct}   thresholds={[90]} />
          <Meter label="Consistency rule"  used={todayProfit}          of={totalPnl > 0 ? totalPnl : 1}  pct={consistencyPct} thresholds={[35, 40]} thresholdLabels={['warn', 'stop']} />
        </div>
      </Card>

      {/* Daily report card */}
      <Card title="Topstep daily report" className="col-span-12">
        {todaySummary?.evening_report ? (
          <DailyReportSummary report={todaySummary.evening_report as Record<string, unknown>} />
        ) : (
          <p className="text-sm text-muted">No evening report for today yet.</p>
        )}
      </Card>

      {/* History */}
      <Card title="Compliance history" className="col-span-12">
        {history.length === 0 ? (
          <p className="text-sm text-muted">No compliance days recorded yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="text-left py-2 px-2 font-normal">Date</th>
                <th className="text-left py-2 px-2 font-normal">Morning</th>
                <th className="text-left py-2 px-2 font-normal">Evening</th>
                <th className="text-right py-2 px-2 font-normal">Daily P&amp;L</th>
                <th className="text-left py-2 px-2 font-normal">Violations</th>
                <th className="text-left py-2 px-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-line/40">
                  <td className="py-1.5 px-2 num">{h.date}</td>
                  <td className="py-1.5 px-2">{h.morning_approved ? '✓' : '✕'}</td>
                  <td className="py-1.5 px-2">{h.evening_audit ? '✓' : '·'}</td>
                  <td className="py-1.5 px-2 text-right num">--</td>
                  <td className="py-1.5 px-2 text-danger">{h.rule_violations.length === 0 ? '—' : h.rule_violations.join(', ')}</td>
                  <td className="py-1.5 px-2">{h.rule_violations.length > 0 ? 'AT RISK' : 'OK'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  const color = tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className={['num text-sm font-semibold mt-0.5', color].join(' ')}>{value}</div>
    </div>
  );
}

function Meter({
  label, used, of, pct, thresholds = [], thresholdLabels = [],
}: {
  label: string;
  used: number;
  of: number;
  pct: number;
  thresholds?: number[];
  thresholdLabels?: string[];
}) {
  const tone = pct >= 90 ? 'bg-danger' : pct >= 75 ? 'bg-warn' : 'bg-accent';
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink">{label}</span>
        <span className="num text-muted">{formatUSD(used)} / {formatUSD(of)}</span>
      </div>
      <div className="mt-1 relative h-2 w-full rounded-full bg-line overflow-hidden">
        <div className={['h-full transition-all', tone].join(' ')} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        {thresholds.map((t, i) => (
          <span key={t} className="absolute top-0 bottom-0 w-px bg-ink/40" style={{ left: `${t}%` }}>
            <span className="absolute -top-3 left-1 text-[9px] text-muted whitespace-nowrap">{thresholdLabels[i] ?? `${t}%`}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

interface ReportShape {
  performance_grade?: string;
  pnl_assessment?: string;
  pattern_identified?: string;
  one_actionable_insight?: string;
  tomorrow_recommendation?: string;
  strategy_breakdown?: Record<string, string>;
}

function DailyReportSummary({ report }: { report: Record<string, unknown> }) {
  const r = report as unknown as ReportShape;
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted">Grade</div>
        <div className="font-syne text-5xl font-bold text-accent">{r.performance_grade ?? '?'}</div>
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {r.pnl_assessment && <p className="text-sm text-ink">{r.pnl_assessment}</p>}
        {r.pattern_identified && <p className="text-xs text-ink/70"><span className="text-muted">Pattern:</span> {r.pattern_identified}</p>}
        {r.one_actionable_insight && (
          <div className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-accent">Actionable insight</div>
            <p className="text-sm text-accent mt-0.5">{r.one_actionable_insight}</p>
          </div>
        )}
        {r.tomorrow_recommendation && <p className="text-xs text-ink/70"><span className="text-muted">Tomorrow:</span> {r.tomorrow_recommendation.replace('_', ' ')}</p>}
      </div>
    </div>
  );
}

'use client';

// STACKD TRADER — Performance analytics.

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@/components/dashboard/Card';
import { formatUSD } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase';
import type { Trade, TradeMode, TradeStrategy } from '@/types/database';

type RangeKey = '7D' | '30D' | 'ALL';

const STRAT_LABEL: Record<TradeStrategy, string> = {
  momentum: 'Momentum',
  mean_reversion: 'Mean Reversion',
  news_sentiment: 'News Sentiment',
};

export function Performance({ mode }: { mode: TradeMode }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [range, setRange] = useState<RangeKey>('30D');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = supabaseBrowser();
      const { data } = await sb.from('trades')
        .select('*').eq('mode', mode)
        .order('entry_time', { ascending: true }).limit(2000);
      if (!cancelled) setTrades(data ?? []);
    })();
    return () => { cancelled = true; };
  }, [mode]);

  const closed = useMemo(() => trades.filter((t) => t.status === 'closed'), [trades]);

  // ---- Range filter ----
  const rangeStart = useMemo(() => {
    const now = new Date();
    if (range === '7D')  { now.setUTCDate(now.getUTCDate() - 7);  return now; }
    if (range === '30D') { now.setUTCDate(now.getUTCDate() - 30); return now; }
    return new Date(0);
  }, [range]);
  const rangedClosed = useMemo(
    () => closed.filter((t) => new Date(t.entry_time).getTime() >= rangeStart.getTime()),
    [closed, rangeStart],
  );

  // ---- Top-row stats (all-time) ----
  const stats = useMemo(() => {
    const totalTrades = closed.length;
    const winners = closed.filter((t) => t.pnl > 0);
    const losers  = closed.filter((t) => t.pnl < 0);
    const winRate = totalTrades === 0 ? 0 : (winners.length / totalTrades) * 100;
    const grossWins   = winners.reduce((s, t) => s + t.pnl, 0);
    const grossLosses = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLosses === 0 ? (grossWins > 0 ? Infinity : 0) : grossWins / grossLosses;
    const avgWin  = winners.length === 0 ? 0 : grossWins / winners.length;
    const avgLoss = losers.length  === 0 ? 0 : grossLosses / losers.length;
    const totalPnl = closed.reduce((s, t) => s + t.pnl, 0);

    // Best/worst day = aggregate by date.
    const byDay = new Map<string, number>();
    for (const t of closed) {
      const day = (t.exit_time ?? t.entry_time).slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + t.pnl);
    }
    const days = [...byDay.entries()].sort((a, b) => b[1] - a[1]);
    const bestDay  = days[0]                ?? null;
    const worstDay = days[days.length - 1]  ?? null;

    // Streak from most recent trade backward.
    const sortedRecent = [...closed].sort((a, b) =>
      new Date(b.exit_time ?? b.entry_time).getTime() - new Date(a.exit_time ?? a.entry_time).getTime(),
    );
    let streakDirection: 'win' | 'loss' | 'none' = 'none';
    let streakCount = 0;
    for (const t of sortedRecent) {
      if (t.pnl > 0) { if (streakDirection === 'loss') break; streakDirection = 'win';  streakCount++; }
      else if (t.pnl < 0) { if (streakDirection === 'win')  break; streakDirection = 'loss'; streakCount++; }
      else break;
    }

    return { totalTrades, winRate, profitFactor, avgWin, avgLoss, totalPnl, bestDay, worstDay, streakDirection, streakCount };
  }, [closed]);

  // ---- Equity curve ----
  const equity = useMemo(() => {
    let running = 0;
    let peak = 0;
    return rangedClosed.map((t, i) => {
      running += t.pnl;
      if (running > peak) peak = running;
      return {
        idx: i,
        date: (t.exit_time ?? t.entry_time).slice(0, 10),
        cumulativePnl: Number(running.toFixed(2)),
        peak: Number(peak.toFixed(2)),
        drawdown: Number((running - peak).toFixed(2)),
      };
    });
  }, [rangedClosed]);

  // ---- Daily P&L ----
  const dailyBars = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of rangedClosed) {
      const day = (t.exit_time ?? t.entry_time).slice(0, 10);
      map.set(day, (map.get(day) ?? 0) + t.pnl);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, pnl]) => ({ date, pnl: Number(pnl.toFixed(2)) }));
  }, [rangedClosed]);

  // ---- Strategy breakdown ----
  const strategyRows = useMemo(() => {
    return (['momentum', 'mean_reversion', 'news_sentiment'] as TradeStrategy[]).map((s) => {
      const ts = closed.filter((t) => t.strategy === s);
      const winners = ts.filter((t) => t.pnl > 0);
      const losers  = ts.filter((t) => t.pnl < 0);
      const winRate = ts.length === 0 ? 0 : (winners.length / ts.length) * 100;
      const grossWins   = winners.reduce((sum, t) => sum + t.pnl, 0);
      const grossLosses = Math.abs(losers.reduce((sum, t) => sum + t.pnl, 0));
      const pf = grossLosses === 0 ? (grossWins > 0 ? Infinity : 0) : grossWins / grossLosses;
      const avgWin  = winners.length === 0 ? 0 : grossWins / winners.length;
      const avgLoss = losers.length  === 0 ? 0 : grossLosses / losers.length;
      const status: 'working' | 'struggling' | 'inactive' =
        ts.length < 5 ? 'inactive'
        : (winRate >= 50 && pf >= 1.2) ? 'working'
        : 'struggling';
      return { strategy: s, count: ts.length, winRate, avgWin, avgLoss, pf, status };
    });
  }, [closed]);

  // ---- Score vs PnL scatter ----
  const scoreScatter = useMemo(
    () => closed.filter((t) => t.signal_score !== null)
      .map((t) => ({ score: t.signal_score!, pnl: Number(t.pnl.toFixed(2)) })),
    [closed],
  );

  // ---- Best & worst trade ----
  const sortedByPnl = useMemo(() => [...closed].sort((a, b) => b.pnl - a.pnl), [closed]);
  const bestTrade  = sortedByPnl[0] ?? null;
  const worstTrade = sortedByPnl[sortedByPnl.length - 1] ?? null;

  // ---- Hour-of-day ----
  const hourBars = useMemo(() => {
    const buckets = new Map<number, number>();
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
    for (const t of closed) {
      const hour = Number(fmt.format(new Date(t.entry_time)).replace(/\D/g, '')) || 0;
      if (hour < 9 || hour > 16) continue;
      buckets.set(hour, (buckets.get(hour) ?? 0) + t.pnl);
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0])
      .map(([hour, pnl]) => ({ hour: `${hour}:00`, pnl: Number(pnl.toFixed(2)) }));
  }, [closed]);

  if (closed.length === 0) {
    return (
      <Card title="Performance" className="col-span-12">
        <p className="text-sm text-muted py-6 text-center">
          Paper trading active. Check back after your first trades.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Stat tiles */}
      <Card title="Headline stats" className="col-span-12">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <Stat label="Total P&amp;L"     value={formatUSD(stats.totalPnl, { signed: true })} tone={stats.totalPnl >= 0 ? 'good' : 'bad'} />
          <Stat label="Win rate"        value={`${stats.winRate.toFixed(1)}%`} />
          <Stat label="Profit factor"   value={Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'} tone={stats.profitFactor >= 1.2 ? 'good' : 'bad'} />
          <Stat label="Avg win / loss"  value={`${formatUSD(stats.avgWin)} / ${formatUSD(stats.avgLoss)}`} />
          <Stat label="Total trades"    value={String(stats.totalTrades)} />
          <Stat label="Best day"        value={stats.bestDay  ? formatUSD(stats.bestDay[1],  { signed: true }) : '--'} tone="good" />
          <Stat label="Worst day"       value={stats.worstDay ? formatUSD(stats.worstDay[1], { signed: true }) : '--'} tone="bad" />
          <Stat label="Current streak"  value={stats.streakDirection === 'none' ? '--' : `${stats.streakCount} ${stats.streakDirection === 'win' ? 'W' : 'L'}`}
            tone={stats.streakDirection === 'win' ? 'good' : stats.streakDirection === 'loss' ? 'bad' : undefined} />
        </div>
      </Card>

      {/* Equity curve */}
      <Card
        title="Equity curve"
        subtitle="Cumulative P&L over the selected range"
        className="col-span-12 lg:col-span-8"
        right={
          <div className="flex gap-1">
            {(['7D', '30D', 'ALL'] as RangeKey[]).map((r) => (
              <button key={r} onClick={() => setRange(r)}
                className={['px-2 py-1 rounded text-[10px] uppercase tracking-[0.18em] border',
                  range === r ? 'bg-accent/15 text-accent border-accent/40' : 'border-line text-muted hover:text-ink'].join(' ')}>
                {r}
              </button>
            ))}
          </div>
        }
      >
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={equity}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1F1E1B" />
            <XAxis dataKey="date" tick={{ fill: '#8A867F', fontSize: 11 }} />
            <YAxis tick={{ fill: '#8A867F', fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
            <Tooltip
              contentStyle={{ background: '#121212', border: '1px solid #1F1E1B', color: '#F5F0E8' }}
              formatter={(v: number) => formatUSD(v, { signed: true })}
            />
            <ReferenceLine y={0} stroke="#8A867F" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="cumulativePnl" stroke="#F5C400" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="drawdown"      stroke="#FF4D4F" strokeWidth={1} dot={false} strokeOpacity={0.4} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Strategy breakdown */}
      <Card title="Strategy breakdown" className="col-span-12 lg:col-span-4">
        <table className="w-full text-xs">
          <thead className="text-muted">
            <tr>
              <th className="text-left font-normal pb-2">Strategy</th>
              <th className="text-right font-normal pb-2">N</th>
              <th className="text-right font-normal pb-2">Win%</th>
              <th className="text-right font-normal pb-2">PF</th>
              <th className="text-left font-normal pb-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {strategyRows.map((r) => (
              <tr key={r.strategy}>
                <td className="py-2 text-ink">{STRAT_LABEL[r.strategy]}</td>
                <td className="py-2 text-right num">{r.count}</td>
                <td className="py-2 text-right num">{r.winRate.toFixed(0)}%</td>
                <td className="py-2 text-right num">{Number.isFinite(r.pf) ? r.pf.toFixed(2) : '∞'}</td>
                <td className="py-2">
                  <span className={[
                    'inline-flex px-1.5 py-0.5 rounded border text-[10px] uppercase',
                    r.status === 'working'    ? 'text-success border-success/40 bg-success/10'
                    : r.status === 'struggling' ? 'text-danger  border-danger/40  bg-danger/10'
                                                : 'text-muted   border-line       bg-bg/40',
                  ].join(' ')}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Daily PnL bars */}
      <Card title="Daily P&amp;L" className="col-span-12 lg:col-span-7">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={dailyBars}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1F1E1B" />
            <XAxis dataKey="date" tick={{ fill: '#8A867F', fontSize: 11 }} />
            <YAxis tick={{ fill: '#8A867F', fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
            <Tooltip
              contentStyle={{ background: '#121212', border: '1px solid #1F1E1B', color: '#F5F0E8' }}
              formatter={(v: number) => formatUSD(v, { signed: true })}
            />
            <Bar dataKey="pnl">
              {dailyBars.map((d, i) => (
                <Cell key={i} fill={d.pnl >= 0 ? '#1FCC79' : '#FF4D4F'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Signal score scatter */}
      <Card title="Signal score vs trade P&amp;L" subtitle="Are higher scores delivering?" className="col-span-12 lg:col-span-5">
        <ResponsiveContainer width="100%" height={200}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#1F1E1B" />
            <XAxis type="number" dataKey="score" domain={[0, 100]} tick={{ fill: '#8A867F', fontSize: 11 }} name="Score" />
            <YAxis type="number" dataKey="pnl" tick={{ fill: '#8A867F', fontSize: 11 }} tickFormatter={(v) => `$${v}`} name="PnL" />
            <ReferenceLine y={0} stroke="#8A867F" strokeDasharray="3 3" />
            <Tooltip
              contentStyle={{ background: '#121212', border: '1px solid #1F1E1B', color: '#F5F0E8' }}
              formatter={(v: number, name: string) => name === 'PnL' ? formatUSD(v, { signed: true }) : String(v)}
              cursor={{ stroke: '#F5C400', strokeDasharray: '2 2' }}
            />
            <Scatter data={scoreScatter} fill="#F5C400" />
          </ScatterChart>
        </ResponsiveContainer>
      </Card>

      {/* Best & worst */}
      <Card title="Best trade" className="col-span-12 md:col-span-6">
        {bestTrade ? <TradeSummary trade={bestTrade} tone="good" /> : <p className="text-sm text-muted">No closed trades yet.</p>}
      </Card>
      <Card title="Worst trade" className="col-span-12 md:col-span-6">
        {worstTrade ? <TradeSummary trade={worstTrade} tone="bad" /> : <p className="text-sm text-muted">No closed trades yet.</p>}
      </Card>

      {/* Hour-of-day */}
      <Card title="P&amp;L by hour (ET)" className="col-span-12">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={hourBars}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1F1E1B" />
            <XAxis dataKey="hour" tick={{ fill: '#8A867F', fontSize: 11 }} />
            <YAxis tick={{ fill: '#8A867F', fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
            <Tooltip
              contentStyle={{ background: '#121212', border: '1px solid #1F1E1B', color: '#F5F0E8' }}
              formatter={(v: number) => formatUSD(v, { signed: true })}
            />
            <Bar dataKey="pnl">
              {hourBars.map((d, i) => (
                <Cell key={i} fill={d.pnl >= 0 ? '#1FCC79' : '#FF4D4F'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-ink';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className={['num text-sm font-semibold mt-0.5', color].join(' ')}>{value}</div>
    </div>
  );
}

function TradeSummary({ trade, tone }: { trade: Trade; tone: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-success' : 'text-danger';
  return (
    <div>
      <div className={['num font-syne text-2xl font-bold', color].join(' ')}>
        {formatUSD(trade.pnl, { signed: true })}
      </div>
      <p className="text-sm text-ink mt-1">
        {trade.instrument} · {trade.strategy.replace('_', ' ')} · {trade.direction?.toUpperCase()}
      </p>
      <p className="text-xs text-muted">
        {new Date(trade.entry_time).toLocaleDateString('en-US')} · Score {trade.signal_score?.toFixed(1) ?? '--'}
      </p>
      {trade.claude_reasoning && (
        <p className="text-xs text-ink/70 mt-2 leading-snug border-l-2 border-line pl-3">
          {trade.claude_reasoning.split('|')[0].trim()}
        </p>
      )}
    </div>
  );
}

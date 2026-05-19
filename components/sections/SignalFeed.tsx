'use client';

// STACKD TRADER — Signal Feed section.

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/dashboard/Card';
import { SignalCard } from '@/components/SignalCard';
import { ENTER_THRESHOLD } from '@/lib/constants';
import { INSTRUMENTS } from '@/lib/instruments';
import type { Signal, TradeStrategy } from '@/types/database';

type ActionFilter = 'all' | 'enter' | 'skip';
type DateFilter = 'today' | 'week' | 'all';

export function SignalFeed({ signals }: { signals: Signal[] }) {
  const [actionFilter, setActionFilter]   = useState<ActionFilter>('all');
  const [minScore, setMinScore]           = useState<number>(0);
  const [dateFilter, setDateFilter]       = useState<DateFilter>('today');
  const [selectedInstr, setSelectedInstr] = useState<Set<string>>(new Set(INSTRUMENTS.map((i) => i.key)));
  const [selectedStrat, setSelectedStrat] = useState<Set<TradeStrategy>>(new Set(['momentum', 'mean_reversion', 'news_sentiment']));

  const filtered = useMemo(() => {
    const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
    const startOfWeek = new Date(); startOfWeek.setUTCDate(startOfWeek.getUTCDate() - 7);
    return signals.filter((s) => {
      if (actionFilter !== 'all' && s.action !== actionFilter) return false;
      if (s.total_score < minScore) return false;
      if (!selectedInstr.has(s.instrument)) return false;
      if (!selectedStrat.has(s.strategy)) return false;
      const t = new Date(s.created_at).getTime();
      if (dateFilter === 'today' && t < startOfDay.getTime()) return false;
      if (dateFilter === 'week'  && t < startOfWeek.getTime()) return false;
      return true;
    });
  }, [signals, actionFilter, minScore, selectedInstr, selectedStrat, dateFilter]);

  // ---- Today stats ----
  const todayStats = useMemo(() => {
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const today = signals.filter((s) => new Date(s.created_at).getTime() >= start.getTime());
    const enters = today.filter((s) => s.action === 'enter').length;
    const skips  = today.filter((s) => s.action === 'skip').length;
    const scores = today.map((s) => s.total_score);
    const avg = scores.length === 0 ? 0 : scores.reduce((a, b) => a + b, 0) / scores.length;
    const max = scores.length === 0 ? 0 : Math.max(...scores);
    return { total: today.length, enters, skips, avg, max };
  }, [signals]);

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Stats bar */}
      <Card title="Today's signals" className="col-span-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Total"       value={String(todayStats.total)} />
          <Stat label="Enter"       value={String(todayStats.enters)} tone="good" />
          <Stat label="Skip"        value={String(todayStats.skips)}  tone="muted" />
          <Stat label="Avg score"   value={todayStats.avg.toFixed(1)} />
          <Stat label="Top score"   value={todayStats.max.toFixed(1)} tone="accent" />
        </div>
      </Card>

      {/* Filters */}
      <Card title="Filters" className="col-span-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label>Action</Label>
            <div className="flex gap-1 mt-1">
              {(['all', 'enter', 'skip'] as ActionFilter[]).map((a) => (
                <button key={a} onClick={() => setActionFilter(a)}
                  className={['px-2 py-1 rounded text-[10px] uppercase tracking-[0.18em] border flex-1',
                    actionFilter === a ? 'bg-accent/15 text-accent border-accent/40' : 'border-line text-muted hover:text-ink'].join(' ')}>
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Date</Label>
            <div className="flex gap-1 mt-1">
              {(['today', 'week', 'all'] as DateFilter[]).map((d) => (
                <button key={d} onClick={() => setDateFilter(d)}
                  className={['px-2 py-1 rounded text-[10px] uppercase tracking-[0.18em] border flex-1',
                    dateFilter === d ? 'bg-accent/15 text-accent border-accent/40' : 'border-line text-muted hover:text-ink'].join(' ')}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Min score: <span className="text-accent num">{minScore}</span></Label>
            <input
              type="range" min={0} max={100} step={1}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-full accent-accent mt-1"
            />
          </div>
          <div>
            <Label>Instruments</Label>
            <div className="flex gap-1 mt-1 flex-wrap">
              {INSTRUMENTS.map((i) => {
                const active = selectedInstr.has(i.key);
                return (
                  <button key={i.key}
                    onClick={() => {
                      const next = new Set(selectedInstr);
                      active ? next.delete(i.key) : next.add(i.key);
                      setSelectedInstr(next);
                    }}
                    className={['px-2 py-1 rounded text-[10px] uppercase tracking-[0.18em] border',
                      active ? 'bg-accent/15 text-accent border-accent/40' : 'border-line text-muted hover:text-ink'].join(' ')}>
                    {i.display}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="mt-3">
          <Label>Strategies</Label>
          <div className="flex gap-1 mt-1">
            {(['momentum', 'mean_reversion', 'news_sentiment'] as TradeStrategy[]).map((s) => {
              const active = selectedStrat.has(s);
              return (
                <button key={s}
                  onClick={() => {
                    const next = new Set(selectedStrat);
                    active ? next.delete(s) : next.add(s);
                    setSelectedStrat(next);
                  }}
                  className={['px-2 py-1 rounded text-[10px] uppercase tracking-[0.18em] border',
                    active ? 'bg-accent/15 text-accent border-accent/40' : 'border-line text-muted hover:text-ink'].join(' ')}>
                  {s.replace('_', ' ')}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Signal cards */}
      <Card
        title="Signals"
        subtitle={`Enter threshold: ${ENTER_THRESHOLD}. Lower scores auto-skip.`}
        className="col-span-12"
      >
        {filtered.length === 0 ? (
          <p className="text-sm text-muted py-6 text-center">No signals match current filters.</p>
        ) : (
          <ul className="-mt-2">
            {filtered.map((s) => <SignalCard key={s.id} signal={s} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'muted' | 'accent' }) {
  const color =
    tone === 'good'   ? 'text-success' :
    tone === 'bad'    ? 'text-danger'  :
    tone === 'muted'  ? 'text-muted'   :
    tone === 'accent' ? 'text-accent'  : 'text-ink';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className={['num text-lg font-semibold mt-0.5', color].join(' ')}>{value}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] uppercase tracking-[0.18em] text-muted">{children}</span>;
}

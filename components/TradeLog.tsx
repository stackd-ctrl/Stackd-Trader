'use client';

// STACKD TRADER — Trade log with filters + paginated table.

import { useEffect, useMemo, useState } from 'react';
import { Card } from './dashboard/Card';
import { formatUSD } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase';
import type {
  Trade,
  TradeDirection,
  TradeMode,
  TradeStatus,
  TradeStrategy,
} from '@/types/database';

const STRAT_TONE: Record<TradeStrategy, string> = {
  momentum:        'text-success border-success/40 bg-success/10',
  mean_reversion:  'text-accent  border-accent/40  bg-accent/10',
  news_sentiment:  'text-warn    border-warn/40    bg-warn/10',
};

const STATUS_TONE: Record<TradeStatus, string> = {
  open:      'text-accent  border-accent/40  bg-accent/10',
  closed:    'text-muted   border-line       bg-bg/40',
  cancelled: 'text-danger  border-danger/40  bg-danger/10',
};

const PAGE_SIZE = 25;

const ET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
  hour12: false,
});

function formatET(iso: string): string {
  return ET_FMT.format(new Date(iso));
}

interface Filters {
  mode: TradeMode | 'all';
  strategy: TradeStrategy | 'all';
  status: TradeStatus | 'all';
  direction: TradeDirection | 'all';
  fromDate: string;
  toDate: string;
}

export function TradeLog({ mode: defaultMode }: { mode: TradeMode }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    mode: defaultMode,
    strategy: 'all',
    status: 'all',
    direction: 'all',
    fromDate: '',
    toDate: '',
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = supabaseBrowser();
      let q = sb.from('trades').select('*').order('entry_time', { ascending: false }).limit(500);
      if (filters.mode !== 'all') q = q.eq('mode', filters.mode);
      if (filters.strategy !== 'all') q = q.eq('strategy', filters.strategy);
      if (filters.status !== 'all') q = q.eq('status', filters.status);
      if (filters.direction !== 'all') q = q.eq('direction', filters.direction);
      if (filters.fromDate) q = q.gte('entry_time', new Date(filters.fromDate).toISOString());
      if (filters.toDate) q = q.lte('entry_time', new Date(filters.toDate + 'T23:59:59Z').toISOString());
      const { data } = await q;
      if (!cancelled) {
        setTrades(data ?? []);
        setPage(0);
      }
    })();
    return () => { cancelled = true; };
  }, [filters]);

  const pageStart = page * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, trades.length);
  const pageTrades = trades.slice(pageStart, pageEnd);
  const totalPages = Math.max(1, Math.ceil(trades.length / PAGE_SIZE));

  const summary = useMemo(() => {
    const total = trades.length;
    const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const closed = trades.filter((t) => t.status === 'closed');
    const winners = closed.filter((t) => t.pnl > 0).length;
    const winRate = closed.length === 0 ? 0 : (winners / closed.length) * 100;
    const scores = trades.map((t) => t.signal_score).filter((s): s is number => s !== null);
    const avgScore = scores.length === 0 ? 0 : scores.reduce((s, n) => s + n, 0) / scores.length;
    return { total, totalPnl, winRate, avgScore };
  }, [trades]);

  return (
    <Card title="Trade Log" className="col-span-12">
      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
        <FilterSelect label="Mode" value={filters.mode} onChange={(v) => setFilters({ ...filters, mode: v as Filters['mode'] })}
          options={[['all', 'All'], ['paper', 'Paper'], ['live_crypto', 'Live Crypto'], ['live_futures', 'Live Futures'], ['topstep', 'Topstep']]} />
        <FilterSelect label="Strategy" value={filters.strategy} onChange={(v) => setFilters({ ...filters, strategy: v as Filters['strategy'] })}
          options={[['all', 'All'], ['momentum', 'Momentum'], ['mean_reversion', 'Mean reversion'], ['news_sentiment', 'News sentiment']]} />
        <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilters({ ...filters, status: v as Filters['status'] })}
          options={[['all', 'All'], ['open', 'Open'], ['closed', 'Closed'], ['cancelled', 'Cancelled']]} />
        <FilterSelect label="Direction" value={filters.direction} onChange={(v) => setFilters({ ...filters, direction: v as Filters['direction'] })}
          options={[['all', 'All'], ['long', 'Long'], ['short', 'Short']]} />
        <FilterInput label="From" type="date" value={filters.fromDate} onChange={(v) => setFilters({ ...filters, fromDate: v })} />
        <FilterInput label="To"   type="date" value={filters.toDate}   onChange={(v) => setFilters({ ...filters, toDate: v })} />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <Th>Time (ET)</Th>
              <Th>Instr</Th>
              <Th>Strat</Th>
              <Th>Dir</Th>
              <Th right>Entry</Th>
              <Th right>Exit</Th>
              <Th right>Stop</Th>
              <Th right>Target</Th>
              <Th right>Size</Th>
              <Th right>P&amp;L</Th>
              <Th right>Score</Th>
              <Th>Status</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {pageTrades.length === 0 ? (
              <tr><td colSpan={13} className="py-4 text-center text-muted">No trades match the filters.</td></tr>
            ) : pageTrades.map((t) => {
              const isOpen = t.status === 'open';
              return (
                <>
                  <tr key={t.id} className="border-b border-line/50 hover:bg-line/20 transition">
                    <Td>{formatET(t.entry_time)}</Td>
                    <Td>{t.instrument}</Td>
                    <Td><span className={['inline-flex px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-[0.14em]', STRAT_TONE[t.strategy]].join(' ')}>{t.strategy.replace('_', ' ')}</span></Td>
                    <Td>
                      <span className={t.direction === 'long' ? 'text-success' : t.direction === 'short' ? 'text-danger' : 'text-muted'}>
                        {t.direction?.toUpperCase() ?? '--'}
                      </span>
                    </Td>
                    <Td right num>${t.entry_price.toFixed(2)}</Td>
                    <Td right num>{t.exit_price !== null ? `$${t.exit_price.toFixed(2)}` : <span className="text-accent">OPEN</span>}</Td>
                    <Td right num>${t.stop_loss.toFixed(2)}</Td>
                    <Td right num>${t.take_profit.toFixed(2)}</Td>
                    <Td right num>{t.quantity}</Td>
                    <Td right num>
                      <span className={t.pnl > 0 ? 'text-success' : t.pnl < 0 ? 'text-danger' : 'text-muted'}>
                        {isOpen ? '--' : formatUSD(t.pnl, { signed: true })}
                      </span>
                    </Td>
                    <Td right num>{t.signal_score?.toFixed(1) ?? '--'}</Td>
                    <Td><span className={['inline-flex px-1.5 py-0.5 rounded border text-[10px] uppercase', STATUS_TONE[t.status]].join(' ')}>{t.status}</span></Td>
                    <Td>
                      <button onClick={() => setExpanded(expanded === t.id ? null : t.id)} className="text-[10px] uppercase tracking-[0.14em] text-muted hover:text-accent transition">
                        {expanded === t.id ? '−' : '+'}
                      </button>
                    </Td>
                  </tr>
                  {expanded === t.id && (
                    <tr key={`${t.id}-detail`} className="border-b border-line/50 bg-bg/40">
                      <td colSpan={13} className="p-3">
                        {t.claude_reasoning && (
                          <p className="text-xs text-ink/80 mb-2"><span className="text-muted">Claude:</span> {t.claude_reasoning}</p>
                        )}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                          <div><span className="text-muted">Multiplier:</span> {t.contract_multiplier}</div>
                          <div><span className="text-muted">Exit reason:</span> {t.exit_reason ?? '--'}</div>
                          <div><span className="text-muted">Exit time:</span> {t.exit_time ? formatET(t.exit_time) : '--'}</div>
                          <div><span className="text-muted">Entry order:</span> {t.entry_order_id?.slice(0, 12) ?? '--'}</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary + pagination */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-line text-xs">
        <div className="grid grid-cols-4 gap-4">
          <Stat label="Trades"     value={String(summary.total)} />
          <Stat label="Total P&amp;L" value={formatUSD(summary.totalPnl, { signed: true })}
            accent={summary.totalPnl >= 0 ? 'good' : 'bad'} />
          <Stat label="Win rate"   value={`${summary.winRate.toFixed(1)}%`} />
          <Stat label="Avg score"  value={summary.avgScore.toFixed(1)} />
        </div>

        {trades.length > PAGE_SIZE && (
          <div className="flex items-center gap-2 text-muted">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="px-2 py-1 disabled:opacity-30 hover:text-accent">‹</button>
            <span>{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="px-2 py-1 disabled:opacity-30 hover:text-accent">›</button>
          </div>
        )}
      </div>
    </Card>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={['py-2 px-2 font-normal', right ? 'text-right' : 'text-left'].join(' ')}>{children}</th>;
}
function Td({ children, right, num }: { children: React.ReactNode; right?: boolean; num?: boolean }) {
  return (
    <td className={['py-2 px-2', right ? 'text-right' : 'text-left', num ? 'num' : ''].join(' ')}>
      {children}
    </td>
  );
}
function Stat({ label, value, accent }: { label: string; value: string; accent?: 'good' | 'bad' }) {
  const tone = accent === 'good' ? 'text-success' : accent === 'bad' ? 'text-danger' : 'text-ink';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className={['num text-sm font-semibold', tone].join(' ')}>{value}</div>
    </div>
  );
}
function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full bg-bg border border-line rounded-md px-2 py-1.5 text-ink text-xs focus:border-accent focus:outline-none">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
function FilterInput({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full bg-bg border border-line rounded-md px-2 py-1.5 text-ink text-xs focus:border-accent focus:outline-none" />
    </label>
  );
}

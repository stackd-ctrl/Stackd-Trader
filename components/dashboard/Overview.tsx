'use client';

import { useEffect, useRef, useState } from 'react';
import { formatScore, formatUSD, timeAgo } from '@/lib/format';
import { ENTER_THRESHOLD, effectiveAction } from '@/lib/constants';
import {
  REGIME_LABELS,
  type BotStatus,
  type RiskSettings,
  type Signal,
} from '@/types/database';
import { Card } from './Card';

const REGIME_TONE: Record<string, string> = {
  trending:           'text-success border-success/40 bg-success/10',
  ranging:            'text-ink     border-line       bg-bg/40',
  high_volatility:    'text-warn    border-warn/40    bg-warn/10',
  extreme_volatility: 'text-danger  border-danger/40  bg-danger/10',
  low_volatility:     'text-muted   border-line       bg-bg/40',
};

export function Overview({
  status,
  risk,
  winRate,
  recentSignals,
  onToggleKill,
}: {
  status: BotStatus;
  risk: RiskSettings;
  winRate: number;
  recentSignals: Signal[];
  onToggleKill: () => void;
}) {
  // Day 1: visualize daily loss against the topstep $ limit (which is also seeded
  // for non-topstep modes). Day 2 swaps this for a proper equity-based calc using
  // risk.daily_loss_limit_pct against the account balance.
  const dollarLimit = Math.max(1, risk.topstep_daily_loss_limit);
  const usedDollars = status.daily_pnl < 0 ? Math.abs(status.daily_pnl) : 0;
  const usagePct = Math.min(100, (usedDollars / dollarLimit) * 100);

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Regime */}
      <Card title="Current Regime" className="col-span-12 md:col-span-3">
        <div
          className={[
            'mt-1 inline-flex items-center gap-2 px-3 py-1.5 rounded-md border',
            REGIME_TONE[status.regime] ?? 'border-line text-ink',
          ].join(' ')}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          <span className="text-sm font-medium">{REGIME_LABELS[status.regime]}</span>
        </div>
        <p className="text-xs text-muted mt-3">
          Updated {timeAgo(status.last_updated)}
        </p>
      </Card>

      {/* Bot status + kill switch */}
      <Card
        title="Bot Status"
        className="col-span-12 md:col-span-3"
        right={
          <span
            className={[
              'inline-flex items-center gap-2 text-xs uppercase tracking-[0.14em]',
              status.is_active ? 'text-success' : 'text-muted',
            ].join(' ')}
          >
            <span
              className={[
                'h-2 w-2 rounded-full',
                status.is_active ? 'bg-success animate-pulse' : 'bg-muted',
              ].join(' ')}
            />
            {status.is_active ? 'Active' : 'Idle'}
          </span>
        }
      >
        <KillSwitchButton isActive={status.is_active} onToggle={onToggleKill} />
        {status.daily_loss_limit_hit && (
          <p className="text-[11px] text-danger mt-2">
            Daily loss limit hit. Bot locked for the session.
          </p>
        )}
      </Card>

      {/* Today P&L */}
      <Card title="Today P&amp;L" className="col-span-6 md:col-span-3">
        <div
          className={[
            'num text-3xl font-syne font-bold',
            status.daily_pnl >= 0 ? 'text-success' : 'text-danger',
          ].join(' ')}
        >
          {formatUSD(status.daily_pnl, { signed: true })}
        </div>
        <p className="text-xs text-muted">{status.daily_trades} trades today</p>
      </Card>

      {/* Win rate */}
      <Card title="Win Rate Today" className="col-span-6 md:col-span-3">
        <div className="num text-3xl font-syne font-bold text-ink">
          {winRate.toFixed(1)}%
        </div>
        <p className="text-xs text-muted">Closed trades only</p>
      </Card>

      {/* Signal feed preview */}
      <Card
        title="Recent Signals"
        subtitle={`Enter threshold: score ≥ ${ENTER_THRESHOLD.toFixed(1)}. Lower scores auto-skip.`}
        className="col-span-12 lg:col-span-7"
        right={
          <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-accent border border-accent/40 bg-accent/10 px-2 py-1 rounded">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            min {ENTER_THRESHOLD.toFixed(1)}
          </span>
        }
      >
        {recentSignals.length === 0 ? (
          <p className="text-sm text-muted">
            No signals yet. The bot will start scoring as soon as the data feed connects.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {recentSignals.slice(0, 5).map((s) => {
              const action = effectiveAction(s.total_score);
              const isEnter = action === 'enter';
              return (
                <li key={s.id} className="py-2.5 flex items-center gap-4">
                  <div
                    className={[
                      'w-12 num text-base font-semibold',
                      isEnter ? 'text-accent' : 'text-muted',
                    ].join(' ')}
                  >
                    {formatScore(s.total_score)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink truncate">
                      <span className="font-medium">{s.instrument}</span>
                      <span className="text-muted"> &middot; {s.strategy.replace('_', ' ')}</span>
                    </div>
                    <div className="text-xs text-muted truncate">
                      {s.claude_explanation ?? 'No reasoning recorded.'}
                    </div>
                  </div>
                  <span
                    className={[
                      'shrink-0 text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded border',
                      isEnter
                        ? 'text-success border-success/40 bg-success/10'
                        : 'text-muted border-line bg-bg/40',
                    ].join(' ')}
                  >
                    {action}
                  </span>
                  <span className="text-[11px] text-muted w-16 text-right">
                    {timeAgo(s.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Risk meter */}
      <Card
        title="Risk Meter"
        subtitle="Daily loss limit usage"
        className="col-span-12 lg:col-span-5"
      >
        <RiskMeter usagePct={usagePct} />

        <div className="flex items-center justify-between mt-3">
          <span className="num text-sm text-ink">
            <span className={usedDollars > 0 ? 'text-danger' : 'text-ink'}>
              {formatUSD(usedDollars)}
            </span>
            <span className="text-muted"> of {formatUSD(dollarLimit)}</span>
          </span>
          <span
            className={[
              'num text-sm font-semibold',
              usagePct >= 75 ? 'text-danger' : usagePct >= 50 ? 'text-warn' : 'text-success',
            ].join(' ')}
          >
            {usagePct.toFixed(1)}%
          </span>
        </div>

        <p className="text-[11px] text-muted mt-2">
          At 100% the bot auto-shuts down for the session.
        </p>
        {usagePct >= 75 && usagePct < 100 && (
          <p className="text-[11px] text-danger mt-1">
            Critical zone. Auto-shutdown imminent.
          </p>
        )}
        {usagePct >= 100 && (
          <p className="text-[11px] text-danger mt-1 font-semibold">
            Bot auto-shutdown triggered.
          </p>
        )}
      </Card>
    </div>
  );
}

// ---- Risk meter -------------------------------------------------------------

function RiskMeter({ usagePct }: { usagePct: number }) {
  // Color tiers: green 0..50, yellow 50..75, red 75..100.
  const tone =
    usagePct >= 75 ? 'bg-danger' : usagePct >= 50 ? 'bg-warn' : 'bg-success';

  return (
    <div className="space-y-1.5">
      <div className="relative h-3 w-full rounded-full bg-line overflow-hidden">
        <div
          className={['h-full rounded-full transition-all duration-500', tone].join(' ')}
          style={{ width: `${usagePct}%` }}
        />
        {/* Tier dividers at 50% and 75% so the user can read the bar without the legend. */}
        <span className="absolute top-0 bottom-0 w-px bg-bg/70" style={{ left: '50%' }} />
        <span className="absolute top-0 bottom-0 w-px bg-bg/70" style={{ left: '75%' }} />
      </div>
      <div className="flex justify-between text-[10px] uppercase tracking-[0.18em] text-muted">
        <span>0%</span>
        <span className="text-success">Safe</span>
        <span className="text-warn">Warn</span>
        <span className="text-danger">Critical</span>
        <span>100%</span>
      </div>
    </div>
  );
}

// ---- Kill switch with two-click confirmation -------------------------------

function KillSwitchButton({
  isActive,
  onToggle,
}: {
  isActive: boolean;
  onToggle: () => void;
}) {
  const [arming, setArming] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clear any pending timers on unmount.
  useEffect(() => () => clearTick(), []);

  function clearTick() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  function startArmedWindow() {
    setArming(true);
    setRemaining(3);
    clearTick();
    const startedAt = Date.now();
    tickRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const left = Math.max(0, 3 - elapsed);
      setRemaining(left);
      if (left <= 0) {
        clearTick();
        setArming(false);
      }
    }, 100);
  }

  function handleClick() {
    // Start path: no confirm step needed.
    if (!isActive) {
      onToggle();
      return;
    }
    // Stop path: arm on first click, execute on second click within 3s.
    if (!arming) {
      startArmedWindow();
      return;
    }
    clearTick();
    setArming(false);
    onToggle();
  }

  if (!isActive) {
    return (
      <button
        onClick={handleClick}
        className="mt-1 w-full px-3 py-2 rounded-md text-sm font-semibold transition border bg-accent/15 text-accent border-accent/40 hover:bg-accent/25"
      >
        Start Bot
      </button>
    );
  }

  if (arming) {
    const pct = Math.max(0, (remaining / 3) * 100);
    return (
      <button
        onClick={handleClick}
        className="mt-1 relative w-full px-3 py-2 rounded-md text-sm font-semibold transition border bg-danger text-bg border-danger overflow-hidden"
      >
        {/* Countdown fill draining left-to-right. */}
        <span
          className="absolute inset-y-0 left-0 bg-bg/20 transition-all"
          style={{ width: `${100 - pct}%` }}
        />
        <span className="relative">CONFIRM STOP? ({remaining.toFixed(1)}s)</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className="mt-1 w-full px-3 py-2 rounded-md text-sm font-semibold transition border bg-danger/15 text-danger border-danger/40 hover:bg-danger/25"
    >
      Kill Switch
    </button>
  );
}

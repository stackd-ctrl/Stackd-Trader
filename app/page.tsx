'use client';

import { useEffect, useMemo, useState } from 'react';
import { Sidebar, type SectionKey, type SidebarBadges } from '@/components/dashboard/Sidebar';
import { MobileNav } from '@/components/dashboard/MobileNav';
import { TopBar } from '@/components/dashboard/TopBar';
import { ModeToggle } from '@/components/dashboard/ModeToggle';
import { Overview } from '@/components/dashboard/Overview';
import { Card } from '@/components/dashboard/Card';
import { PriceDisplay } from '@/components/PriceDisplay';
import { MorningBrief } from '@/components/MorningBrief';
import { EveningReport } from '@/components/EveningReport';
import { AnomalyAlert } from '@/components/AnomalyAlert';
import { LivePositions } from '@/components/LivePositions';
import { ManualTrade } from '@/components/ManualTrade';
import { TradeLog } from '@/components/TradeLog';
import { PaperActivation } from '@/components/PaperActivation';
import { PaperProgress } from '@/components/PaperProgress';
import { Performance } from '@/components/sections/Performance';
import { RiskMonitor } from '@/components/sections/RiskMonitor';
import { TopstepCompliance } from '@/components/sections/TopstepCompliance';
import { Settings as SettingsSection } from '@/components/sections/Settings';
import { SignalFeed } from '@/components/sections/SignalFeed';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import {
  mockBotStatus,
  mockRiskSettings,
  mockSignals,
} from '@/lib/mockData';
import { supabaseBrowser } from '@/lib/supabase';
import type { MorningBrief as MorningBriefShape } from '@/lib/claude/morning';
import type { EveningReport as EveningReportShape } from '@/lib/claude/evening';
import type { RiskSettings, TradeMode } from '@/types/database';

const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export default function Page() {
  const [mode, setMode] = useState<TradeMode>('paper');
  const [section, setSection] = useState<SectionKey>('overview');
  const [mockActive, setMockActive] = useState(true);
  const [dismissedBrief, setDismissedBrief] = useState(false);
  const [showActivation, setShowActivation] = useState(false);
  const [riskSettings, setRiskSettings] = useState<RiskSettings | null>(null);
  const [lastSeenSignalAt, setLastSeenSignalAt] = useState<string | null>(null);

  const live = useRealtimeData(SUPABASE_CONFIGURED ? mode : 'paper');

  // Load risk_settings for RiskMonitor + TopstepCompliance.
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) {
      setRiskSettings(null);
      return;
    }
    const sb = supabaseBrowser();
    sb.from('risk_settings').select('*').eq('mode', mode).single().then(({ data }) => setRiskSettings(data ?? null));
  }, [mode]);

  // Decide whether to show the paper activation gate.
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) { setShowActivation(false); return; }
    if (!live.status) return;
    setShowActivation(!live.status.paper_started_at);
  }, [live.status]);

  // Track last-seen signal timestamp for "new signals" badge.
  useEffect(() => {
    if (section === 'signals' && live.signals[0]) {
      setLastSeenSignalAt(live.signals[0].created_at);
    }
  }, [section, live.signals]);

  const fallbackStatus = useMemo(() => {
    const s = mockBotStatus(mode);
    return { ...s, is_active: mockActive };
  }, [mode, mockActive]);

  const status = SUPABASE_CONFIGURED && live.status ? live.status : fallbackStatus;
  const risk = riskSettings ?? mockRiskSettings(mode);
  const signals = SUPABASE_CONFIGURED && live.signals.length > 0 ? live.signals : (SUPABASE_CONFIGURED ? [] : mockSignals(mode));

  const winRate = useMemo(() => {
    const closed = live.trades.filter((t) => t.status === 'closed');
    if (closed.length === 0) return SUPABASE_CONFIGURED ? 0 : 62.5;
    const winners = closed.filter((t) => t.pnl > 0).length;
    return (winners / closed.length) * 100;
  }, [live.trades]);

  const topAnomaly = useMemo(() => {
    if (live.anomalies.length === 0) return null;
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...live.anomalies].sort((a, b) => order[a.severity] - order[b.severity])[0];
  }, [live.anomalies]);

  const morningBrief  = (live.dailySummary?.morning_brief  ?? null) as MorningBriefShape | null;
  const eveningReport = (live.dailySummary?.evening_report ?? null) as EveningReportShape | null;
  const showMorningBrief  = morningBrief && !dismissedBrief && !live.dailySummary?.morning_read_at;
  const showEveningReport = Boolean(eveningReport);

  // ---- Sidebar badges ----
  const openPositionsCount = live.trades.filter((t) => t.status === 'open').length;
  const newSignalsCount = lastSeenSignalAt
    ? live.signals.filter((s) => s.created_at > lastSeenSignalAt).length
    : Math.min(live.signals.length, 9);

  const sidebarBadges: SidebarBadges = {
    positions:  openPositionsCount > 0 ? { count: openPositionsCount, tone: 'red' } : undefined,
    signals:    newSignalsCount > 0    ? { count: newSignalsCount,    tone: 'gold' } : undefined,
    risk:       (status.daily_loss_limit_hit || (status.consecutive_losses ?? 0) >= 3) ? 'alert' : null,
    compliance: (mode === 'topstep' && status.daily_loss_limit_hit) ? 'warning' : null,
  };

  // ---- Actions ----

  async function toggleKill() {
    const next = !status.is_active;
    if (!SUPABASE_CONFIGURED) { setMockActive(next); return; }
    try {
      await fetch(`/api/bot-status?mode=${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: next }),
      });
      if (next) {
        void fetch(`/api/regime?mode=${mode}`, { method: 'POST' });
      } else {
        void fetch(`/api/execution/closeAll?mode=${mode}`, { method: 'POST' });
      }
    } catch {
      // silent — error boundary catches render-time failures
    }
  }

  async function closePosition(tradeId: string, reason: 'manual' | 'strategy_change' | 'risk_concern') {
    if (!SUPABASE_CONFIGURED) return;
    try {
      await fetch('/api/execution/exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId, reason }),
      });
    } catch {
      // silent
    }
  }

  async function dismissMorningBrief() {
    setDismissedBrief(true);
    if (!SUPABASE_CONFIGURED) return;
    try {
      await fetch(`/api/daily-summary?mode=${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'morning' }),
      });
    } catch { /* silent */ }
  }

  async function acknowledgeAnomaly(id: string) {
    if (!SUPABASE_CONFIGURED) return;
    try {
      await fetch('/api/anomalies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch { /* silent */ }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar
        mode={mode}
        dailyPnl={status.daily_pnl}
        dailyTrades={status.daily_trades}
        botActive={status.is_active}
      >
        <PriceDisplay mode={mode} prices={live.prices} />
        <ModeToggle mode={mode} onChange={setMode} />
      </TopBar>

      <MobileNav active={section} onSelect={setSection} badges={sidebarBadges} />

      <div className="flex flex-1">
        <Sidebar active={section} onSelect={setSection} badges={sidebarBadges} />

        <main className="flex-1 p-4 md:p-6 min-w-0">
          {!SUPABASE_CONFIGURED && (
            <div className="mb-4 px-4 py-2 rounded-md border border-warn/40 bg-warn/10 text-warn text-xs">
              Running on mock data. Add Supabase + Alpaca + Polygon + Anthropic keys to .env.local for live mode.
            </div>
          )}
          {live.error && (
            <div className="mb-4 px-4 py-2 rounded-md border border-danger/40 bg-danger/10 text-danger text-xs">
              Realtime error: {live.error}
            </div>
          )}

          {section === 'overview' && (
            <div className="grid grid-cols-12 gap-4">
              {showMorningBrief && morningBrief && (
                <MorningBrief brief={morningBrief} onDismiss={dismissMorningBrief} />
              )}
              <div className="col-span-12">
                <Overview
                  status={status}
                  risk={risk}
                  winRate={winRate}
                  recentSignals={signals}
                  onToggleKill={toggleKill}
                />
              </div>
              <PaperProgress status={live.status} trades={live.trades} />
              {showEveningReport && eveningReport && <EveningReport report={eveningReport} />}
            </div>
          )}

          {section === 'positions' && (
            <div className="space-y-4">
              <ManualTrade mode={mode} />
              <LivePositions
                trades={live.trades}
                prices={live.prices}
                todaysTradeCount={status.daily_trades}
                todaysPnl={status.daily_pnl}
                onClose={closePosition}
              />
            </div>
          )}

          {section === 'signals'     && <SignalFeed signals={signals} />}
          {section === 'trades'      && <TradeLog mode={mode} />}
          {section === 'performance' && <Performance mode={mode} />}
          {section === 'risk'        && <RiskMonitor mode={mode} status={live.status} riskSettings={riskSettings} />}
          {section === 'compliance'  && <TopstepCompliance mode={mode} status={live.status} riskSettings={riskSettings} />}
          {section === 'settings'    && <SettingsSection mode={mode} />}
        </main>
      </div>

      {topAnomaly && (
        <AnomalyAlert
          anomaly={topAnomaly}
          onAcknowledge={() => acknowledgeAnomaly(topAnomaly.id)}
        />
      )}

      {showActivation && (
        <PaperActivation
          mode={mode}
          onActivated={() => setShowActivation(false)}
          onSkip={() => setShowActivation(false)}
        />
      )}
    </div>
  );
}

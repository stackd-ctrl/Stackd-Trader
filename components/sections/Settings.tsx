'use client';

// STACKD TRADER — Settings section. Composes existing widgets and adds new ones.

import { useEffect, useState } from 'react';
import { Card } from '@/components/dashboard/Card';
import { HealthCheck } from '@/components/HealthCheck';
import { ClaudeUsage } from '@/components/ClaudeUsage';
import { CronTriggers } from '@/components/CronTriggers';
import { supabaseBrowser } from '@/lib/supabase';
import type {
  RiskSettings,
  StrategyFlag,
  TradeMode,
  TradeStrategy,
} from '@/types/database';

export function Settings({ mode }: { mode: TradeMode }) {
  return (
    <div className="grid grid-cols-12 gap-4">
      <HealthCheck />
      <BotConfiguration mode={mode} />
      <RiskParameters mode={mode} />
      {mode === 'topstep' && <TopstepConfiguration mode={mode} />}
      <StrategyToggles mode={mode} />
      <CronTriggers />
      <ClaudeUsage />
      <DangerZone mode={mode} />
    </div>
  );
}

// ---- Bot configuration -----------------------------------------------------

function BotConfiguration({ mode }: { mode: TradeMode }) {
  return (
    <Card title="Bot configuration" className="col-span-12 lg:col-span-6">
      <div className="space-y-3 text-xs">
        <Row label="Trading mode">
          <span className="text-ink uppercase tracking-wide">{mode.replace('_', ' ')}</span>
          <span className="text-muted ml-2">(change from top-bar mode toggle)</span>
        </Row>
        <Row label="Trading hours">
          <span className="text-ink">09:45–15:45 ET</span>
          <span className="text-muted ml-2">(crypto bypasses; 24/7)</span>
        </Row>
        <Row label="Instruments">
          <span className="text-ink">BTC/USD, ETH/USD, MES, MNQ</span>
          <span className="text-muted ml-2">(per-mode allowlist in lib/instruments.ts)</span>
        </Row>
        <Row label="Max trades / day">
          <span className="text-ink num">10</span>
          <span className="text-muted ml-2">(enforced by risk guard)</span>
        </Row>
        <p className="text-[11px] text-muted pt-2 border-t border-line">
          Active toggle + kill switch live in the Overview header. Mode switching to any
          live mode requires typing CONFIRM in the top-bar modal.
        </p>
      </div>
    </Card>
  );
}

// ---- Risk parameters -------------------------------------------------------

interface RiskField {
  key: keyof Pick<RiskSettings, 'max_risk_per_trade_pct' | 'daily_loss_limit_pct' | 'profit_target_pct' | 'max_contracts'>;
  label: string;
  min: number;
  max: number;
  step: number;
  warnAbove?: number;
  format: (n: number) => string;
}

const RISK_FIELDS: RiskField[] = [
  { key: 'max_risk_per_trade_pct', label: 'Max risk per trade',  min: 0.5, max: 3,  step: 0.1, warnAbove: 2,   format: (n) => `${n.toFixed(2)}%` },
  { key: 'daily_loss_limit_pct',   label: 'Daily loss limit',    min: 1,   max: 5,  step: 0.1, warnAbove: 4,   format: (n) => `${n.toFixed(2)}%` },
  { key: 'profit_target_pct',      label: 'Daily profit target', min: 1,   max: 10, step: 0.1, format: (n) => `${n.toFixed(2)}%` },
  { key: 'max_contracts',          label: 'Max contracts',       min: 1,   max: 10, step: 1,   warnAbove: 2,   format: (n) => String(n) },
];

function RiskParameters({ mode }: { mode: TradeMode }) {
  const [settings, setSettings] = useState<RiskSettings | null>(null);
  const [pendingPatch, setPendingPatch] = useState<{ key: RiskField['key']; value: number; label: string } | null>(null);

  async function load() {
    const res = await fetch(`/api/risk-settings?mode=${mode}`);
    if (res.ok) setSettings(await res.json());
  }

  useEffect(() => { void load(); }, [mode]);

  async function confirmPatch() {
    if (!pendingPatch) return;
    await fetch(`/api/risk-settings?mode=${mode}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [pendingPatch.key]: pendingPatch.value }),
    });
    setPendingPatch(null);
    await load();
  }

  return (
    <Card title="Risk parameters" className="col-span-12 lg:col-span-6">
      {!settings ? (
        <p className="text-sm text-muted">Loading risk settings…</p>
      ) : (
        <div className="space-y-3">
          {RISK_FIELDS.map((f) => {
            const current = Number(settings[f.key]);
            const warning = f.warnAbove !== undefined && current > f.warnAbove;
            return (
              <div key={f.key}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink">{f.label}</span>
                  <span className={['num font-semibold', warning ? 'text-warn' : 'text-accent'].join(' ')}>
                    {f.format(current)}
                  </span>
                </div>
                <input
                  type="range"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={current}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setPendingPatch({ key: f.key, value: v, label: f.label });
                  }}
                  className="w-full mt-1 accent-accent"
                />
                {warning && <p className="text-[11px] text-warn">Above recommended ceiling — review carefully.</p>}
              </div>
            );
          })}
        </div>
      )}

      {pendingPatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setPendingPatch(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-xl border border-warn/40 bg-panel p-5">
            <h3 className="font-syne text-lg text-ink">Confirm change</h3>
            <p className="text-sm text-ink/85 mt-2">Change <span className="text-accent">{pendingPatch.label}</span> to <span className="num font-semibold">{pendingPatch.value}</span>?</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPendingPatch(null)} className="px-4 py-2 rounded-md text-sm text-ink/80 hover:bg-line/40">Cancel</button>
              <button onClick={confirmPatch} className="px-4 py-2 rounded-md text-sm font-semibold bg-accent text-bg hover:bg-accent/90">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---- Topstep configuration -------------------------------------------------

function TopstepConfiguration({ mode }: { mode: TradeMode }) {
  const [settings, setSettings] = useState<RiskSettings | null>(null);

  useEffect(() => {
    fetch(`/api/risk-settings?mode=${mode}`)
      .then((r) => r.ok ? r.json() : null)
      .then(setSettings)
      .catch(() => undefined);
  }, [mode]);

  if (!settings) return null;

  return (
    <Card title="Topstep configuration" subtitle="Editable only in Topstep mode" className="col-span-12 lg:col-span-6">
      <div className="grid grid-cols-2 gap-3 text-xs">
        <Stat label="Daily loss limit"   value={`$${Number(settings.topstep_daily_loss_limit).toFixed(2)}`} />
        <Stat label="Max drawdown"       value={`$${Number(settings.topstep_max_drawdown).toFixed(2)}`} />
        <Stat label="Profit target"      value={`$${Number(settings.topstep_profit_target).toFixed(2)}`} />
        <Stat label="Min trading days"   value="—" />
      </div>
      <p className="text-[11px] text-muted mt-3">
        Edit via PATCH /api/risk-settings with field names topstep_daily_loss_limit, topstep_max_drawdown, topstep_profit_target.
      </p>
    </Card>
  );
}

// ---- Strategy toggles ------------------------------------------------------

function StrategyToggles({ mode }: { mode: TradeMode }) {
  const [flags, setFlags] = useState<StrategyFlag[]>([]);
  const [pendingOff, setPendingOff] = useState<TradeStrategy | null>(null);

  async function load() {
    const sb = supabaseBrowser();
    const { data } = await sb.from('strategy_flags').select('*').eq('mode', mode);
    setFlags(data ?? []);
  }
  useEffect(() => { void load(); }, [mode]);

  async function toggle(s: TradeStrategy, next: boolean) {
    await fetch(`/api/strategy-flags?mode=${mode}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: s, is_enabled: next }),
    });
    setPendingOff(null);
    await load();
  }

  const all: TradeStrategy[] = ['momentum', 'mean_reversion', 'news_sentiment'];

  return (
    <Card title="Strategy toggles" className="col-span-12 lg:col-span-6">
      <div className="space-y-2">
        {all.map((s) => {
          const flag = flags.find((f) => f.strategy === s);
          const enabled = flag?.is_enabled ?? true;
          return (
            <div key={s} className="flex items-center justify-between rounded-md border border-line bg-bg/40 p-3">
              <div>
                <div className="text-sm text-ink">{s.replace('_', ' ')}</div>
                <div className="text-[11px] text-muted">Active in signal scan when on</div>
              </div>
              <button
                onClick={() => enabled ? setPendingOff(s) : toggle(s, true)}
                className={[
                  'px-3 py-1.5 rounded text-xs font-semibold border',
                  enabled
                    ? 'bg-success/15 text-success border-success/40'
                    : 'bg-bg/40 text-muted border-line',
                ].join(' ')}
              >
                {enabled ? 'ON' : 'OFF'}
              </button>
            </div>
          );
        })}
      </div>

      {pendingOff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setPendingOff(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-xl border border-warn/40 bg-panel p-5">
            <h3 className="font-syne text-lg text-ink">Disable strategy?</h3>
            <p className="text-sm text-ink/85 mt-2">
              Disabling <span className="text-accent">{pendingOff.replace('_', ' ')}</span> removes it from the signal scan immediately.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPendingOff(null)} className="px-4 py-2 rounded-md text-sm text-ink/80 hover:bg-line/40">Cancel</button>
              <button onClick={() => toggle(pendingOff, false)} className="px-4 py-2 rounded-md text-sm font-semibold bg-warn text-bg hover:bg-warn/90">Disable</button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---- Danger zone -----------------------------------------------------------

function DangerZone({ mode }: { mode: TradeMode }) {
  const [pending, setPending] = useState<'reset_daily' | 'clear_signals' | null>(null);
  const [confirm, setConfirm] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const expected = pending === 'reset_daily' ? 'RESET' : 'CLEAR';

  async function go() {
    if (!pending) return;
    const res = await fetch('/api/danger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: pending, confirmation: confirm, mode }),
    });
    const body = await res.json();
    setResult(res.ok ? `OK: ${pending}${body.deleted ? ` (${body.deleted} rows)` : ''}` : `ERROR: ${body.error}`);
    setPending(null);
    setConfirm('');
  }

  return (
    <Card
      title="Danger zone"
      subtitle="Destructive. Never deletes trade history."
      className="col-span-12 border-danger/40"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DangerButton
          label="Reset daily stats"
          description="Zero daily_pnl, daily_trades, consecutive_losses; clear paused_until."
          onClick={() => { setPending('reset_daily'); setConfirm(''); }}
        />
        <DangerButton
          label="Clear all signals"
          description="Delete every row from the signals table for this mode."
          onClick={() => { setPending('clear_signals'); setConfirm(''); }}
        />
      </div>
      {result && <p className="text-xs text-ink/80 mt-3">{result}</p>}

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setPending(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-danger/50 bg-panel p-5">
            <h3 className="font-syne text-lg text-ink">{pending === 'reset_daily' ? 'Reset daily stats' : 'Clear all signals'}</h3>
            <p className="text-sm text-ink/85 mt-2">Type <span className="font-mono text-danger">{expected}</span> to proceed.</p>
            <input
              autoFocus
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={expected}
              className="mt-3 w-full bg-bg border border-line focus:border-danger focus:outline-none rounded-md px-3 py-2 text-ink tracking-[0.18em]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPending(null)} className="px-4 py-2 rounded-md text-sm text-ink/80 hover:bg-line/40">Cancel</button>
              <button
                onClick={go}
                disabled={confirm !== expected}
                className={[
                  'px-4 py-2 rounded-md text-sm font-semibold',
                  confirm === expected ? 'bg-danger text-bg hover:bg-danger/90' : 'bg-line text-muted cursor-not-allowed',
                ].join(' ')}
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function DangerButton({ label, description, onClick }: { label: string; description: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-md border border-danger/30 bg-danger/5 p-3 hover:bg-danger/10 transition"
    >
      <div className="font-medium text-danger">{label}</div>
      <div className="text-[11px] text-ink/70 mt-1">{description}</div>
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-b-0">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</span>
      <div className="text-right">{children}</div>
    </div>
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

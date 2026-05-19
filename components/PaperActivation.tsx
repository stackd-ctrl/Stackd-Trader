'use client';

// STACKD TRADER — One-time paper trading activation gate.

import { useState } from 'react';
import { ENTER_THRESHOLD } from '@/lib/constants';
import type { TradeMode } from '@/types/database';

export function PaperActivation({
  mode,
  onActivated,
  onSkip,
}: {
  mode: TradeMode;
  onActivated: () => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 'done'>(1);
  const [riskAck, setRiskAck] = useState(false);
  const [strategyAck, setStrategyAck] = useState(false);
  const [balance, setBalance] = useState<number>(1000);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function activate() {
    setActivating(true);
    setError(null);
    try {
      const res = await fetch('/api/paper-activation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starting_balance: balance, mode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setStep('done');
      setTimeout(onActivated, 1500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActivating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 overflow-y-auto">
      <div className="w-full max-w-xl rounded-xl border border-accent/30 bg-panel shadow-glow my-8">
        <div className="px-6 py-5 border-b border-line flex items-center justify-between">
          <div>
            <div className="font-syne text-xs tracking-[0.22em] text-accent">STACKD TRADER</div>
            <h2 className="font-syne text-xl text-ink mt-0.5">Paper Trading Activation</h2>
          </div>
          <button onClick={onSkip} className="text-[10px] uppercase tracking-[0.18em] text-muted hover:text-ink">
            Skip for now
          </button>
        </div>

        <div className="px-6 py-6">
          {step === 1 && (
            <Step title="Welcome">
              <p>
                STACKD TRADER is ready. You are about to start <strong className="text-accent">30 days of paper trading</strong>.
                This uses real market data with simulated money. No real capital is at risk.
              </p>
              <p className="text-muted text-sm">
                Day 38 you will review the run and decide whether to enable live trading.
              </p>
            </Step>
          )}

          {step === 2 && (
            <Step title="Confirm risk settings">
              <ul className="space-y-1.5 text-sm">
                <Bullet>Max risk per trade: <span className="text-accent">1.5% of account</span></Bullet>
                <Bullet>Daily loss limit: <span className="text-accent">3% of account</span></Bullet>
                <Bullet>Daily trade cap: <span className="text-accent">10 trades</span></Bullet>
                <Bullet>Consecutive losses cap: <span className="text-accent">3 (30-min cooldown)</span></Bullet>
              </ul>
              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <input type="checkbox" checked={riskAck} onChange={(e) => setRiskAck(e.target.checked)} className="accent-accent" />
                <span className="text-sm text-ink">I have reviewed and confirmed my risk settings</span>
              </label>
            </Step>
          )}

          {step === 3 && (
            <Step title="Confirm strategy review">
              <ul className="space-y-1.5 text-sm">
                <Bullet><strong className="text-ink">Momentum</strong> — fires in trending regimes on RSI 50-65 + MACD momentum</Bullet>
                <Bullet><strong className="text-ink">Mean reversion</strong> — fires in ranging regimes targeting the 20-period MA</Bullet>
                <Bullet><strong className="text-ink">News sentiment</strong> — Claude scores recent headlines, weights into total</Bullet>
              </ul>
              <p className="text-xs text-muted mt-2">Any signal scoring under {ENTER_THRESHOLD} is auto-skipped.</p>
              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <input type="checkbox" checked={strategyAck} onChange={(e) => setStrategyAck(e.target.checked)} className="accent-accent" />
                <span className="text-sm text-ink">I understand my three active strategies and their entry rules</span>
              </label>
            </Step>
          )}

          {step === 4 && (
            <Step title="Set paper starting balance">
              <p className="text-sm text-ink/80">Used for position sizing and drawdown calculations. Pick whatever you would actually allocate.</p>
              <label className="block mt-3">
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted">Starting balance ($)</span>
                <input
                  type="number"
                  value={balance}
                  onChange={(e) => setBalance(Number(e.target.value))}
                  min={100}
                  step={100}
                  className="mt-1 w-full bg-bg border border-line focus:border-accent focus:outline-none rounded-md px-3 py-2 text-ink num text-lg"
                />
              </label>
            </Step>
          )}

          {step === 5 && (
            <Step title="Activate">
              <div className="rounded-md border border-accent/30 bg-accent/5 p-3 text-sm space-y-1">
                <div>Mode: <span className="text-accent uppercase">{mode}</span></div>
                <div>Starting balance: <span className="num text-accent">${balance.toLocaleString('en-US')}</span></div>
                <div className="text-xs text-muted">Cron jobs will begin firing on the next scheduled tick after activation.</div>
              </div>
              {error && <p className="text-xs text-danger mt-2">{error}</p>}
            </Step>
          )}

          {step === 'done' && (
            <div className="text-center py-6">
              <div className="font-syne text-3xl text-success">ACTIVATED</div>
              <p className="text-sm text-muted mt-2">Loading your dashboard…</p>
            </div>
          )}
        </div>

        {step !== 'done' && (
          <div className="px-6 py-4 border-t border-line flex items-center justify-between">
            <Stepper current={step} />
            <div className="flex gap-2">
              {step > 1 && (
                <button onClick={() => setStep((step - 1) as 1 | 2 | 3 | 4)}
                  className="px-4 py-2 rounded-md text-sm text-ink/80 hover:bg-line/40">
                  Back
                </button>
              )}
              {step < 5 ? (
                <button
                  onClick={() => setStep((step + 1) as 2 | 3 | 4 | 5)}
                  disabled={(step === 2 && !riskAck) || (step === 3 && !strategyAck) || (step === 4 && balance <= 0)}
                  className={[
                    'px-4 py-2 rounded-md text-sm font-semibold',
                    (step === 2 && !riskAck) || (step === 3 && !strategyAck) || (step === 4 && balance <= 0)
                      ? 'bg-line text-muted cursor-not-allowed'
                      : 'bg-accent text-bg hover:bg-accent/90',
                  ].join(' ')}
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={activate}
                  disabled={activating}
                  className="px-6 py-2.5 rounded-md text-sm font-syne font-bold tracking-wide bg-accent text-bg hover:bg-accent/90 disabled:opacity-60"
                >
                  {activating ? 'Activating…' : 'ACTIVATE PAPER TRADING'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-syne text-sm uppercase tracking-[0.22em] text-accent">{title}</h3>
      <div className="mt-3 space-y-3 text-ink/90">{children}</div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-accent shrink-0">•</span>
      <span>{children}</span>
    </li>
  );
}

function Stepper({ current }: { current: 1 | 2 | 3 | 4 | 5 | 'done' }) {
  const n = current === 'done' ? 5 : current;
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={['h-1.5 w-6 rounded-full', i <= n ? 'bg-accent' : 'bg-line'].join(' ')}
        />
      ))}
    </div>
  );
}

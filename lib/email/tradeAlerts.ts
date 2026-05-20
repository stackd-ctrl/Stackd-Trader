// STACKD TRADER — Trade alert emails (Resend).
//
// Fires after a successful Alpaca confirmation + Supabase write. Email failure
// must NEVER affect trade execution: every call here is wrapped in try/catch
// at the call site, and a hard 5s timeout caps the network wait.
//
// No-op when RESEND_API_KEY / TRADE_ALERT_FROM / TRADE_ALERT_TO are missing,
// so local dev without Resend credentials keeps working.

import 'server-only';
import { Resend } from 'resend';
import type { ExitReason, TradeDirection, TradeMode } from '@/types/database';

const EMAIL_TIMEOUT_MS = 5_000;

const BG = '#0A0A0A';
const INK = '#F5F0E8';
const ACCENT = '#F5C400';
const PANEL = '#161616';
const LINE = '#2A2A2A';
const MUTED = '#9A938A';
const GREEN = '#4ADE80';
const RED = '#F87171';

interface AlertConfig {
  client: Resend;
  from: string;
  to: string;
}

function getConfig(): AlertConfig | null {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.TRADE_ALERT_FROM;
  const to = process.env.TRADE_ALERT_TO;
  if (!key || !from || !to) return null;
  return { client: new Resend(key), from, to };
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 2,
  }).format(n);
}

function calcRr(entry: number, stop: number, target: number): string {
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (risk === 0) return 'n/a';
  return (reward / risk).toFixed(2);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatReason(r: ExitReason): string {
  switch (r) {
    case 'take_profit':     return 'Take profit hit';
    case 'stop_loss':       return 'Stop loss hit';
    case 'manual':          return 'Manual close';
    case 'end_of_day':      return 'End of day';
    case 'kill_switch':     return 'Kill switch';
    case 'risk_concern':    return 'Risk concern';
    case 'strategy_change': return 'Strategy change';
    default:                return r;
  }
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid ${LINE};font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:.14em">${label}</td>
    <td style="padding:10px 0;border-bottom:1px solid ${LINE};font-size:14px;color:${INK};text-align:right;font-variant-numeric:tabular-nums">${value}</td>
  </tr>`;
}

// ---- Entry email ----------------------------------------------------------

export interface EntryAlertInput {
  tradeId: string;
  mode: TradeMode;
  instrument: string;
  direction: TradeDirection;
  strategy: string;
  size: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  signalScore: number;
  claudeReasoning: string | null;
}

function entryHtml(i: EntryAlertInput): string {
  const sideColor = i.direction === 'long' ? GREEN : RED;
  const sideLabel = i.direction === 'long' ? 'LONG' : 'SHORT';
  const rr = calcRr(i.entryPrice, i.stopLoss, i.takeProfit);
  const reasoning = i.claudeReasoning?.trim() || 'No Claude reasoning attached.';
  const modeLabel = i.mode.toUpperCase();

  return `<!doctype html><html><body style="margin:0;padding:0;background:${BG};font-family:'DM Sans',Arial,sans-serif;color:${INK}">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <div style="border-bottom:1px solid ${LINE};padding-bottom:16px;margin-bottom:24px">
      <div style="font-size:11px;letter-spacing:.18em;color:${MUTED};text-transform:uppercase">STACKD TRADER · ${escapeHtml(modeLabel)}</div>
      <div style="font-family:'Syne',Arial,sans-serif;font-weight:700;font-size:22px;color:${ACCENT};margin-top:6px">Entry filled</div>
    </div>
    <div style="background:${PANEL};border:1px solid ${LINE};border-radius:8px;padding:20px;margin-bottom:20px">
      <div style="font-family:'Syne',Arial,sans-serif;font-size:18px;font-weight:600;color:${INK}">
        ${escapeHtml(i.instrument)} <span style="color:${sideColor}">${sideLabel}</span>
      </div>
      <div style="font-size:12px;color:${MUTED};margin-top:4px">${escapeHtml(i.strategy)}</div>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${row('Size', String(i.size))}
      ${row('Fill price', formatUsd(i.entryPrice))}
      ${row('Stop', formatUsd(i.stopLoss))}
      ${row('Target', formatUsd(i.takeProfit))}
      ${row('R / R', rr)}
      ${row('Signal score', i.signalScore.toFixed(1))}
    </table>
    <div style="margin-top:24px;padding:16px;background:${PANEL};border:1px solid ${LINE};border-radius:8px">
      <div style="font-size:10px;color:${MUTED};text-transform:uppercase;letter-spacing:.18em;margin-bottom:8px">Claude reasoning</div>
      <div style="font-size:13px;line-height:1.5;color:${INK}">${escapeHtml(reasoning)}</div>
    </div>
    <div style="margin-top:24px;font-size:10px;color:${MUTED};text-transform:uppercase;letter-spacing:.18em">
      Trade ${escapeHtml(i.tradeId)}
    </div>
  </div>
</body></html>`;
}

export async function sendEntryAlert(input: EntryAlertInput): Promise<void> {
  const cfg = getConfig();
  if (!cfg) return;

  const sideLabel = input.direction === 'long' ? 'LONG' : 'SHORT';
  const subject = `STACKD TRADER | ENTRY ${input.instrument} ${sideLabel} @ ${formatUsd(input.entryPrice)}`;

  try {
    await withTimeout(
      cfg.client.emails.send({
        from: cfg.from,
        to: cfg.to,
        subject,
        html: entryHtml(input),
      }),
      EMAIL_TIMEOUT_MS,
      'sendEntryAlert',
    );
  } catch (err) {
    console.error('[tradeAlerts] sendEntryAlert failed', err);
  }
}

// ---- Exit email -----------------------------------------------------------

export interface ExitAlertInput {
  tradeId: string;
  mode: TradeMode;
  instrument: string;
  direction: TradeDirection;
  strategy: string;
  size: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  reason: ExitReason;
}

function exitHtml(i: ExitAlertInput): string {
  const pnlColor = i.pnl >= 0 ? GREEN : RED;
  const pnlSign = i.pnl >= 0 ? '+' : '';
  const sideLabel = i.direction === 'long' ? 'LONG' : 'SHORT';
  const reasonLabel = formatReason(i.reason);
  const modeLabel = i.mode.toUpperCase();

  return `<!doctype html><html><body style="margin:0;padding:0;background:${BG};font-family:'DM Sans',Arial,sans-serif;color:${INK}">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <div style="border-bottom:1px solid ${LINE};padding-bottom:16px;margin-bottom:24px">
      <div style="font-size:11px;letter-spacing:.18em;color:${MUTED};text-transform:uppercase">STACKD TRADER · ${escapeHtml(modeLabel)}</div>
      <div style="font-family:'Syne',Arial,sans-serif;font-weight:700;font-size:22px;color:${ACCENT};margin-top:6px">Position closed</div>
    </div>
    <div style="background:${PANEL};border:1px solid ${LINE};border-radius:8px;padding:20px;margin-bottom:20px">
      <div style="font-family:'Syne',Arial,sans-serif;font-size:18px;font-weight:600;color:${INK}">
        ${escapeHtml(i.instrument)} ${sideLabel}
      </div>
      <div style="font-size:12px;color:${MUTED};margin-top:4px">${escapeHtml(i.strategy)} · ${reasonLabel}</div>
      <div style="font-family:'Syne',Arial,sans-serif;font-size:28px;font-weight:700;color:${pnlColor};margin-top:14px;font-variant-numeric:tabular-nums">
        ${pnlSign}${formatUsd(i.pnl)}
      </div>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${row('Size', String(i.size))}
      ${row('Entry', formatUsd(i.entryPrice))}
      ${row('Exit', formatUsd(i.exitPrice))}
    </table>
    <div style="margin-top:24px;font-size:10px;color:${MUTED};text-transform:uppercase;letter-spacing:.18em">
      Trade ${escapeHtml(i.tradeId)}
    </div>
  </div>
</body></html>`;
}

export async function sendExitAlert(input: ExitAlertInput): Promise<void> {
  const cfg = getConfig();
  if (!cfg) return;

  const sideLabel = input.direction === 'long' ? 'LONG' : 'SHORT';
  const pnlSign = input.pnl >= 0 ? '+' : '';
  const subject = `STACKD TRADER | EXIT ${input.instrument} ${sideLabel} ${pnlSign}${formatUsd(input.pnl)}`;

  try {
    await withTimeout(
      cfg.client.emails.send({
        from: cfg.from,
        to: cfg.to,
        subject,
        html: exitHtml(input),
      }),
      EMAIL_TIMEOUT_MS,
      'sendExitAlert',
    );
  } catch (err) {
    console.error('[tradeAlerts] sendExitAlert failed', err);
  }
}

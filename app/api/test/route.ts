// GET /api/test
// Health check for every external dependency. Each check runs in its own
// try/catch so one failure can't crash the report.

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseService } from '@/lib/supabase';
import { getAccount } from '@/lib/alpaca/client';
import { getCandles } from '@/lib/polygon/client';
import { CLAUDE_MODEL } from '@/lib/claude/client';
import type { TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CheckResult<T> { ok: boolean; data?: T; error?: string }

const TABLES = ['trades', 'signals', 'daily_summaries', 'bot_status', 'risk_settings'] as const;
type TableName = (typeof TABLES)[number];

function isoEastern(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const time = `${get('hour')}:${get('minute')}:${get('second')}`;
  // Derive offset by diffing wall-clock ET against UTC instant.
  const etAsUtc = Date.parse(`${date}T${time}Z`);
  const offsetMins = Math.round((etAsUtc - d.getTime()) / 60_000);
  const sign = offsetMins >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMins);
  const offH = String(Math.floor(abs / 60)).padStart(2, '0');
  const offM = String(abs % 60).padStart(2, '0');
  return `${date}T${time}${sign}${offH}:${offM}`;
}

// ---- Individual checks -----------------------------------------------------

async function checkSupabase(): Promise<{
  connected: boolean;
  tables: Record<TableName, boolean>;
  error: string | null;
}> {
  const tables: Record<TableName, boolean> = {
    trades: false, signals: false, daily_summaries: false, bot_status: false, risk_settings: false,
  };
  let connected = false;
  let error: string | null = null;

  let sb;
  try {
    sb = supabaseService();
  } catch (err) {
    return { connected: false, tables, error: (err as Error).message };
  }

  try {
    const { error: e } = await sb.from('bot_status').select('id').limit(1);
    if (e) throw e;
    connected = true;
  } catch (err) {
    error = (err as Error).message;
  }

  // Per-table reachability — running in parallel to keep the endpoint snappy.
  await Promise.all(
    TABLES.map(async (t) => {
      try {
        const { error: e } = await sb!.from(t).select('id').limit(1);
        tables[t] = !e;
      } catch {
        tables[t] = false;
      }
    }),
  );

  return { connected, tables, error };
}

async function checkAlpaca(): Promise<{
  connected: boolean;
  mode: string;
  balance: number | null;
  error: string | null;
}> {
  const mode = (process.env.TRADING_MODE ?? 'paper').toLowerCase();
  try {
    const acct = await getAccount();
    return { connected: true, mode, balance: acct.equity, error: null };
  } catch (err) {
    return { connected: false, mode, balance: null, error: (err as Error).message };
  }
}

async function checkPolygon(): Promise<{
  connected: boolean;
  sample_price: number | null;
  error: string | null;
}> {
  // Use the candles endpoint (free-tier compatible). The /v3/snapshot endpoint
  // requires a paid plan; we don't depend on it for health.
  try {
    const candles = await getCandles('BTC/USD', '1d', 1);
    const price = candles[candles.length - 1]?.close ?? 0;
    if (!price) {
      return { connected: false, sample_price: null, error: 'Candles returned no close price' };
    }
    return { connected: true, sample_price: price, error: null };
  } catch (err) {
    return { connected: false, sample_price: null, error: (err as Error).message };
  }
}

async function checkAnthropic(): Promise<{ connected: boolean; error: string | null }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { connected: false, error: 'ANTHROPIC_API_KEY not set' };
  try {
    const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 8_000 });
    const res = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 10,
      temperature: 0,
      messages: [{ role: 'user', content: 'Reply with the word HEALTHY' }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text).join('').toUpperCase();
    if (text.includes('HEALTHY')) return { connected: true, error: null };
    return { connected: false, error: `Response did not contain HEALTHY: ${text.slice(0, 80)}` };
  } catch (err) {
    return { connected: false, error: (err as Error).message };
  }
}

function checkEnvironment(): Record<string, boolean> {
  const has = (k: string) => Boolean(process.env[k] && process.env[k]!.trim().length > 0);
  return {
    supabase_url:          has('NEXT_PUBLIC_SUPABASE_URL'),
    supabase_anon_key:     has('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    supabase_service_role: has('SUPABASE_SERVICE_ROLE_KEY'),
    // Spec uses ALPACA_PAPER_KEY/SECRET; our setup uses ALPACA_API_KEY_ID/SECRET_KEY
    // (one key pair flipped between paper/live via TRADING_MODE).
    alpaca_paper_key:      has('ALPACA_API_KEY_ID'),
    alpaca_paper_secret:   has('ALPACA_API_SECRET_KEY'),
    alpaca_paper_base_url: has('ALPACA_PAPER_BASE_URL'),
    polygon_key:           has('POLYGON_API_KEY'),
    anthropic_key:         has('ANTHROPIC_API_KEY'),
    trading_mode:          has('TRADING_MODE'),
  };
}

async function checkBotStatus(): Promise<CheckResult<{
  is_active: boolean;
  regime: string;
  daily_pnl: number;
  daily_trades: number;
}>> {
  try {
    const sb = supabaseService();
    const mode: TradeMode = 'paper';
    const { data, error } = await sb.from('bot_status')
      .select('is_active, regime, daily_pnl, daily_trades')
      .eq('mode', mode).single();
    if (error || !data) return { ok: false, error: error?.message ?? 'no row' };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---- Endpoint --------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  // Run every check in parallel.
  const [supabase, alpaca, polygon, anthropic, botStatusRes] = await Promise.all([
    checkSupabase().catch((err) => ({
      connected: false,
      tables: { trades: false, signals: false, daily_summaries: false, bot_status: false, risk_settings: false },
      error: (err as Error).message,
    })),
    checkAlpaca().catch((err) => ({ connected: false, mode: 'unknown', balance: null, error: (err as Error).message })),
    checkPolygon().catch((err) => ({ connected: false, sample_price: null, error: (err as Error).message })),
    checkAnthropic().catch((err) => ({ connected: false, error: (err as Error).message })),
    checkBotStatus().catch((err) => ({
      ok: false,
      error: (err as Error).message,
      data: undefined,
    } as CheckResult<{ is_active: boolean; regime: string; daily_pnl: number; daily_trades: number }>)),
  ]);
  const environment = checkEnvironment();

  // Health rollup.
  const coreConnections = supabase.connected && alpaca.connected;
  const allConnections = coreConnections && polygon.connected && anthropic.connected;
  const requiredEnvOk = Object.values(environment).every(Boolean);
  const tablesAllExist = Object.values(supabase.tables).every(Boolean);

  let overall: 'healthy' | 'degraded' | 'critical';
  if (!coreConnections) overall = 'critical';
  else if (allConnections && requiredEnvOk && tablesAllExist) overall = 'healthy';
  else overall = 'degraded';

  const body = {
    timestamp: isoEastern(),
    overall_health: overall,
    checks: {
      supabase: {
        connected: supabase.connected,
        tables: supabase.tables,
        error: supabase.error,
      },
      alpaca: {
        connected: alpaca.connected,
        mode: alpaca.mode,
        balance: alpaca.balance,
        error: alpaca.error,
      },
      polygon: {
        connected: polygon.connected,
        sample_price: polygon.sample_price,
        error: polygon.error,
      },
      anthropic: {
        connected: anthropic.connected,
        error: anthropic.error,
      },
      environment,
      bot_status: botStatusRes.ok ? botStatusRes.data : null,
    },
  };

  return NextResponse.json(body);
}

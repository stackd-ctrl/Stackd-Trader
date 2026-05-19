// STACKD TRADER — Polygon.io REST client.
// Server-only. Used for historical OHLCV, snapshots, and daily ATR.

import 'server-only';
import { instrumentByKey } from '@/lib/instruments';

export interface Candle {
  time: string;           // ISO timestamp of bar open
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PolygonSnapshot {
  ticker: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
  timestamp: string;
  changePct: number;
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '1d';

export class PolygonError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'PolygonError';
    this.status = status;
    this.body = body;
  }
}

function apiKey(): string {
  const key = process.env.POLYGON_API_KEY;
  if (!key) throw new PolygonError('Missing POLYGON_API_KEY', 0, null);
  return key;
}

function baseUrl(): string {
  return process.env.POLYGON_BASE_URL ?? 'https://api.polygon.io';
}

async function request<T>(path: string, qs: Record<string, string | number> = {}): Promise<T> {
  const params = new URLSearchParams({ apiKey: apiKey() });
  for (const [k, v] of Object.entries(qs)) params.set(k, String(v));
  const url = `${baseUrl()}${path}?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (cause) {
    throw new PolygonError(`Network error calling ${path}`, 0, cause);
  }

  if (res.status === 429) {
    throw new PolygonError('Polygon rate limit hit', 429, await safeBody(res));
  }
  if (!res.ok) {
    const body = await safeBody(res);
    throw new PolygonError(`Polygon ${res.status} on ${path}`, res.status, body);
  }
  return (await res.json()) as T;
}

async function safeBody(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  } catch { return null; }
}

// Resolve internal instrument key → Polygon ticker.  Accepts either.
function resolveTicker(input: string): string {
  return instrumentByKey(input)?.polygonTicker ?? input;
}

// Map timeframe → Polygon aggregate (multiplier, timespan).
function tfToAgg(tf: Timeframe): { mult: number; span: string } {
  switch (tf) {
    case '1m':  return { mult: 1, span: 'minute' };
    case '5m':  return { mult: 5, span: 'minute' };
    case '15m': return { mult: 15, span: 'minute' };
    case '1h':  return { mult: 1, span: 'hour' };
    case '1d':  return { mult: 1, span: 'day' };
  }
}

// ---- Public API -------------------------------------------------------------

/**
 * Last N OHLCV candles. Defaults to 100 5-minute bars, which is the default
 * the indicator engine expects on startup.
 */
export async function getCandles(
  instrument: string,
  timeframe: Timeframe = '5m',
  limit = 100,
): Promise<Candle[]> {
  const ticker = resolveTicker(instrument);
  const { mult, span } = tfToAgg(timeframe);

  const to = Date.now();
  // Pull a generous window then trim — handles holidays and after-hours gaps.
  const windowDays = timeframe === '1d' ? 365 : 10;
  const from = to - windowDays * 24 * 60 * 60 * 1000;

  type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
  type Raw = { status: string; results?: Bar[] };

  const raw = await request<Raw>(
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${mult}/${span}/${from}/${to}`,
    { adjusted: 'true', sort: 'asc', limit: 5000 },
  );

  const bars = raw.results ?? [];
  const slice = bars.slice(-limit);
  return slice.map((b) => ({
    time: new Date(b.t).toISOString(),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }));
}

/** Current snapshot — price, day OHLC, volume, % change. */
export async function getSnapshot(instrument: string): Promise<PolygonSnapshot> {
  const ticker = resolveTicker(instrument);
  // Universal snapshot endpoint covers stocks, crypto, options, futures.
  type Raw = {
    results?: Array<{
      ticker: string;
      session?: {
        change_percent?: number;
        open?: number;
        high?: number;
        low?: number;
        close?: number;
        volume?: number;
        previous_close?: number;
        vwap?: number;
        price?: number;
      };
      last_trade?: { price?: number; participant_timestamp?: number };
      market_status?: string;
    }>;
  };
  const raw = await request<Raw>(`/v3/snapshot`, { 'ticker.any_of': ticker });
  const r = raw.results?.[0];
  if (!r) {
    throw new PolygonError(`No snapshot for ${ticker}`, 404, raw);
  }
  const s = r.session ?? {};
  const price = r.last_trade?.price ?? s.price ?? s.close ?? 0;
  return {
    ticker,
    price,
    open: s.open ?? 0,
    high: s.high ?? 0,
    low: s.low ?? 0,
    close: s.close ?? 0,
    volume: s.volume ?? 0,
    vwap: s.vwap ?? null,
    timestamp: r.last_trade?.participant_timestamp
      ? new Date(r.last_trade.participant_timestamp / 1e6).toISOString()
      : new Date().toISOString(),
    changePct: s.change_percent ?? 0,
  };
}

/**
 * 14-period ATR using today's daily candle context (last 14 trading days).
 * Calls the indicator engine to keep math centralized.
 */
export async function getDailyATR(instrument: string): Promise<number> {
  const { ATR } = await import('@/lib/indicators');
  const candles = await getCandles(instrument, '1d', 30);
  if (candles.length < 15) return 0;
  return ATR(candles, 14);
}

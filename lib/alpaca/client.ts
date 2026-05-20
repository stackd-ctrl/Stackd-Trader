// STACKD TRADER — Alpaca REST client.
//
// Server-only. Reads TRADING_MODE to pick paper vs live trading endpoint.
// All public functions throw on non-2xx responses with a typed AlpacaError.

import 'server-only';

export interface AlpacaAccount {
  id: string;
  status: string;
  cash: number;
  buying_power: number;
  portfolio_value: number;
  equity: number;
  last_equity: number;
  daytrade_count: number;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  account_blocked: boolean;
}

export interface AlpacaPosition {
  symbol: string;
  asset_class: string;
  qty: number;
  side: 'long' | 'short';
  avg_entry_price: number;
  current_price: number;
  market_value: number;
  unrealized_pl: number;
  unrealized_plpc: number;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  status: string;
  limit_price: number | null;
  stop_price: number | null;
  filled_avg_price: number | null;
  submitted_at: string;
  updated_at: string;
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';

export interface PlaceOrderInput {
  symbol: string;
  side: OrderSide;
  qty: number;
  type: OrderType;
  time_in_force?: 'day' | 'gtc' | 'ioc';
  limit_price?: number;
  stop_price?: number;
  client_order_id?: string;
}

export class AlpacaError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'AlpacaError';
    this.status = status;
    this.body = body;
  }
}

// ---- Endpoint selection -----------------------------------------------------

function tradingBaseUrl(): string {
  const mode = (process.env.TRADING_MODE ?? 'paper').toLowerCase();
  const paper = process.env.ALPACA_PAPER_BASE_URL ?? 'https://paper-api.alpaca.markets';
  const live = process.env.ALPACA_LIVE_BASE_URL ?? 'https://api.alpaca.markets';
  return mode === 'live' ? live : paper;
}

function dataBaseUrl(): string {
  return process.env.ALPACA_DATA_BASE_URL ?? 'https://data.alpaca.markets';
}

function authHeaders(): HeadersInit {
  const id = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!id || !secret) {
    throw new AlpacaError('Missing ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY', 0, null);
  }
  return {
    'APCA-API-KEY-ID': id,
    'APCA-API-SECRET-KEY': secret,
    'Content-Type': 'application/json',
  };
}

// ---- Core request helper ----------------------------------------------------

async function request<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${baseUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers ?? {}) },
      cache: 'no-store',
    });
  } catch (cause) {
    throw new AlpacaError(`Network error calling ${path}`, 0, cause);
  }

  if (res.status === 429) {
    throw new AlpacaError('Alpaca rate limit hit', 429, await safeBody(res));
  }

  if (!res.ok) {
    const body = await safeBody(res);
    throw new AlpacaError(
      `Alpaca ${res.status} on ${path}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
      res.status,
      body,
    );
  }

  return (await res.json()) as T;
}

async function safeBody(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  } catch {
    return null;
  }
}

// ---- Public API -------------------------------------------------------------

export async function getAccount(): Promise<AlpacaAccount> {
  type Raw = Omit<AlpacaAccount, 'cash' | 'buying_power' | 'portfolio_value' | 'equity' | 'last_equity'>
    & Record<'cash' | 'buying_power' | 'portfolio_value' | 'equity' | 'last_equity', string>;
  const raw = await request<Raw>(tradingBaseUrl(), '/v2/account');
  return {
    ...raw,
    cash: Number(raw.cash),
    buying_power: Number(raw.buying_power),
    portfolio_value: Number(raw.portfolio_value),
    equity: Number(raw.equity),
    last_equity: Number(raw.last_equity),
  };
}

export async function getPositions(): Promise<AlpacaPosition[]> {
  type Raw = Omit<AlpacaPosition, 'qty' | 'avg_entry_price' | 'current_price' | 'market_value' | 'unrealized_pl' | 'unrealized_plpc'>
    & Record<'qty' | 'avg_entry_price' | 'current_price' | 'market_value' | 'unrealized_pl' | 'unrealized_plpc', string>;
  const raw = await request<Raw[]>(tradingBaseUrl(), '/v2/positions');
  return raw.map((p) => ({
    ...p,
    qty: Number(p.qty),
    avg_entry_price: Number(p.avg_entry_price),
    current_price: Number(p.current_price),
    market_value: Number(p.market_value),
    unrealized_pl: Number(p.unrealized_pl),
    unrealized_plpc: Number(p.unrealized_plpc),
  }));
}

export async function getOrders(status: 'open' | 'closed' | 'all' = 'open'): Promise<AlpacaOrder[]> {
  type Raw = Omit<AlpacaOrder, 'qty' | 'limit_price' | 'stop_price' | 'filled_avg_price'>
    & Record<'qty' | 'limit_price' | 'stop_price' | 'filled_avg_price', string | null>;
  const raw = await request<Raw[]>(tradingBaseUrl(), `/v2/orders?status=${status}&limit=100`);
  return raw.map((o) => ({
    ...o,
    qty: Number(o.qty),
    limit_price: o.limit_price === null ? null : Number(o.limit_price),
    stop_price: o.stop_price === null ? null : Number(o.stop_price),
    filled_avg_price: o.filled_avg_price === null ? null : Number(o.filled_avg_price),
  }));
}

export async function placeOrder(input: PlaceOrderInput): Promise<AlpacaOrder> {
  const payload = {
    symbol: input.symbol,
    side: input.side,
    qty: input.qty,
    type: input.type,
    time_in_force: input.time_in_force ?? 'day',
    limit_price: input.limit_price,
    stop_price: input.stop_price,
    client_order_id: input.client_order_id,
  };
  // Server-side validation before the round trip.
  if (input.type === 'limit' && input.limit_price === undefined) {
    throw new AlpacaError('limit_price required for limit orders', 400, null);
  }
  if ((input.type === 'stop' || input.type === 'stop_limit') && input.stop_price === undefined) {
    throw new AlpacaError('stop_price required for stop orders', 400, null);
  }
  return request<AlpacaOrder>(tradingBaseUrl(), '/v2/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function cancelOrder(orderId: string): Promise<void> {
  await fetch(`${tradingBaseUrl()}/v2/orders/${orderId}`, {
    method: 'DELETE',
    headers: authHeaders(),
    cache: 'no-store',
  });
}

export async function closePosition(symbol: string): Promise<void> {
  await fetch(`${tradingBaseUrl()}/v2/positions/${encodeURIComponent(symbol)}`, {
    method: 'DELETE',
    headers: authHeaders(),
    cache: 'no-store',
  });
}

// ---- Snapshot helpers (used by /api/prices) --------------------------------

export interface AlpacaSnapshot {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  timestamp: string;
}

export async function getStocksSnapshot(symbols: string[]): Promise<AlpacaSnapshot[]> {
  if (symbols.length === 0) return [];
  const qs = encodeURIComponent(symbols.join(','));
  const raw = await request<{ snapshots: Record<string, RawSnapshot> }>(
    dataBaseUrl(),
    `/v2/stocks/snapshots?symbols=${qs}`,
  );
  return Object.entries(raw.snapshots).map(([symbol, s]) => mapSnapshot(symbol, s));
}

export async function getCryptoSnapshot(symbols: string[]): Promise<AlpacaSnapshot[]> {
  if (symbols.length === 0) return [];
  const qs = encodeURIComponent(symbols.join(','));
  const raw = await request<{ snapshots: Record<string, RawSnapshot> }>(
    dataBaseUrl(),
    `/v1beta3/crypto/us/snapshots?symbols=${qs}`,
  );
  return Object.entries(raw.snapshots).map(([symbol, s]) => mapSnapshot(symbol, s));
}

interface RawSnapshot {
  latestTrade?: { p?: number; s?: number; t?: string };
  latestQuote?: { ap?: number; bp?: number; t?: string };
  dailyBar?: { o?: number; h?: number; l?: number; c?: number; v?: number };
  minuteBar?: { c?: number; v?: number };
}

// ---- Crypto bars (OHLCV candles) -------------------------------------------
// Free with a ~200/min limit, vs Polygon's free 5/min. Used for the signal
// scan + regime detection so a 5-7 instrument scan doesn't blow the rate cap.

export interface AlpacaBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const CRYPTO_TIMEFRAME: Record<string, string> = {
  '1m': '1Min', '5m': '5Min', '15m': '15Min', '1h': '1Hour', '1d': '1Day',
};

export async function getCryptoBars(
  symbol: string,
  timeframe: keyof typeof CRYPTO_TIMEFRAME,
  limit = 100,
): Promise<AlpacaBar[]> {
  const tf = CRYPTO_TIMEFRAME[timeframe];
  if (!tf) throw new AlpacaError(`Unsupported timeframe: ${timeframe}`, 400, null);

  // Pull a generous window then trim to the most recent `limit` bars.
  const windowDays = timeframe === '1d' ? 400 : 10;
  const start = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const qs = new URLSearchParams({
    symbols: symbol,
    timeframe: tf,
    start,
    limit: '10000',
    sort: 'asc',
  });

  type RawBar = { t: string; o: number; h: number; l: number; c: number; v: number };
  type Raw = { bars?: Record<string, RawBar[]> };
  const raw = await request<Raw>(dataBaseUrl(), `/v1beta3/crypto/us/bars?${qs.toString()}`);
  const bars = raw.bars?.[symbol] ?? [];
  return bars.slice(-limit).map((b) => ({
    time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
  }));
}

function mapSnapshot(symbol: string, s: RawSnapshot): AlpacaSnapshot {
  const price = s.latestTrade?.p ?? s.minuteBar?.c ?? s.dailyBar?.c ?? 0;
  return {
    symbol,
    price,
    open: s.dailyBar?.o ?? 0,
    high: s.dailyBar?.h ?? 0,
    low: s.dailyBar?.l ?? 0,
    volume: s.dailyBar?.v ?? 0,
    timestamp: s.latestTrade?.t ?? new Date().toISOString(),
  };
}

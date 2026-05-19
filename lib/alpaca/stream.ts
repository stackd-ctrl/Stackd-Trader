// STACKD TRADER — Alpaca WebSocket stream.
//
// Server-only. Holds a singleton manager that connects to Alpaca's crypto and
// stocks streams (futures need a separate provider — see lib/instruments.ts).
// Auto-reconnects with exponential backoff and logs every transition to
// Supabase bot_event_log.

import 'server-only';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { supabaseService } from '@/lib/supabase';
import { INSTRUMENTS } from '@/lib/instruments';
import type { TradeMode } from '@/types/database';

export type StreamStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface PriceUpdate {
  instrument: string;       // internal key (e.g. 'BTC/USD')
  price: number;
  volume: number | null;
  timestamp: string;
}

export interface TradeUpdate {
  event: string;            // 'fill' | 'partial_fill' | 'canceled' | ...
  order_id: string;
  symbol: string;
  qty: number;
  price: number | null;
  timestamp: string;
}

export interface StatusUpdate {
  endpoint: 'stocks' | 'crypto';
  status: StreamStatus;
  detail?: string;
}

// Strongly typed event map.
export interface StreamEvents {
  price:  (u: PriceUpdate)  => void;
  trade:  (u: TradeUpdate)  => void;
  status: (u: StatusUpdate) => void;
}

class TypedEmitter extends EventEmitter {
  override on<E extends keyof StreamEvents>(event: E, listener: StreamEvents[E]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override off<E extends keyof StreamEvents>(event: E, listener: StreamEvents[E]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
  override emit<E extends keyof StreamEvents>(event: E, ...args: Parameters<StreamEvents[E]>): boolean {
    return super.emit(event, ...args);
  }
}

// ---- Per-endpoint connection -----------------------------------------------

interface ConnConfig {
  endpoint: 'stocks' | 'crypto';
  url: string;
  symbols: string[];        // formatted for this endpoint
}

class StreamConnection {
  private ws: WebSocket | null = null;
  private retry = 0;
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly cfg: ConnConfig,
    private readonly emitter: TypedEmitter,
    private readonly mode: TradeMode,
  ) {}

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    this.emitStatus('connecting');

    const id = process.env.ALPACA_API_KEY_ID;
    const secret = process.env.ALPACA_API_SECRET_KEY;
    if (!id || !secret) {
      this.emitStatus('error', 'Missing ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY');
      return;
    }

    try {
      this.ws = new WebSocket(this.cfg.url);
    } catch (cause) {
      this.emitStatus('error', `Connect threw: ${(cause as Error).message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.retry = 0;
      this.ws?.send(JSON.stringify({ action: 'auth', key: id, secret }));
    });

    this.ws.on('message', (raw) => this.onMessage(raw.toString()));

    this.ws.on('error', (err) => {
      this.emitStatus('error', err.message);
    });

    this.ws.on('close', () => {
      this.emitStatus('disconnected');
      if (!this.closed) this.scheduleReconnect();
    });
  }

  private onMessage(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;

    for (const msg of parsed as Array<Record<string, unknown>>) {
      const T = msg.T as string | undefined;
      if (T === 'success' && msg.msg === 'authenticated') {
        this.subscribe();
        this.emitStatus('connected');
        continue;
      }
      if (T === 'error') {
        this.emitStatus('error', String(msg.msg ?? 'unknown'));
        continue;
      }
      // Trade prints: t = trade, q = quote, b = bar (1-minute).
      if (T === 't' || T === 'b') {
        const symbol = String(msg.S ?? msg.s ?? '');
        const internal = this.alpacaToInternal(symbol);
        if (!internal) continue;
        this.emitter.emit('price', {
          instrument: internal,
          price: Number(msg.p ?? msg.c ?? 0),
          volume: msg.v === undefined ? null : Number(msg.v),
          timestamp: String(msg.t ?? new Date().toISOString()),
        });
      }
    }
  }

  private subscribe(): void {
    if (!this.ws || this.cfg.symbols.length === 0) return;
    this.ws.send(
      JSON.stringify({
        action: 'subscribe',
        trades: this.cfg.symbols,
        bars: this.cfg.symbols,
      }),
    );
  }

  private alpacaToInternal(alpacaSymbol: string): string | null {
    const match = INSTRUMENTS.find((i) => i.alpacaSymbol === alpacaSymbol);
    return match?.key ?? null;
  }

  private scheduleReconnect(): void {
    const backoffMs = Math.min(30_000, 1000 * 2 ** Math.min(this.retry, 5));
    this.retry++;
    this.reconnectTimer = setTimeout(() => this.connect(), backoffMs);
  }

  private emitStatus(status: StreamStatus, detail?: string): void {
    this.emitter.emit('status', { endpoint: this.cfg.endpoint, status, detail });
    void logStreamStatus(this.mode, this.cfg.endpoint, status, detail);
  }
}

async function logStreamStatus(
  mode: TradeMode,
  endpoint: 'stocks' | 'crypto',
  status: StreamStatus,
  detail?: string,
): Promise<void> {
  try {
    const sb = supabaseService();
    await sb.from('bot_event_log').insert({
      mode,
      level: status === 'error' ? 'error' : 'info',
      category: 'stream',
      message: `${endpoint} stream ${status}${detail ? `: ${detail}` : ''}`,
      context: { endpoint, status, detail: detail ?? null },
    });
  } catch (err) {
    console.error('[stream] log failed', err);
  }
}

// ---- Public manager (singleton) --------------------------------------------

class StreamManager {
  private emitter = new TypedEmitter();
  private connections: StreamConnection[] = [];
  private started = false;
  private currentMode: TradeMode = 'paper';

  start(mode: TradeMode): void {
    if (this.started && this.currentMode === mode) return;
    this.stop();
    this.currentMode = mode;
    this.started = true;

    const stocksUrl = process.env.ALPACA_STREAM_STOCKS
      ?? 'wss://stream.data.alpaca.markets/v2/iex';
    const cryptoUrl = process.env.ALPACA_STREAM_CRYPTO
      ?? 'wss://stream.data.alpaca.markets/v1beta3/crypto/us';

    const stocks = INSTRUMENTS
      .filter((i) => i.feed === 'alpaca_stocks' && i.alpacaSymbol && i.defaultModes.includes(mode))
      .map((i) => i.alpacaSymbol as string);
    const crypto = INSTRUMENTS
      .filter((i) => i.feed === 'alpaca_crypto' && i.alpacaSymbol && i.defaultModes.includes(mode))
      .map((i) => i.alpacaSymbol as string);

    if (stocks.length > 0) {
      this.connections.push(new StreamConnection(
        { endpoint: 'stocks', url: stocksUrl, symbols: stocks },
        this.emitter,
        mode,
      ));
    }
    if (crypto.length > 0) {
      this.connections.push(new StreamConnection(
        { endpoint: 'crypto', url: cryptoUrl, symbols: crypto },
        this.emitter,
        mode,
      ));
    }
    this.connections.forEach((c) => c.start());
  }

  stop(): void {
    this.connections.forEach((c) => c.stop());
    this.connections = [];
    this.started = false;
  }

  on<E extends keyof StreamEvents>(event: E, listener: StreamEvents[E]): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  isRunning(): boolean {
    return this.started;
  }
}

// Singleton across hot-reloads in dev.
declare global {
  // eslint-disable-next-line no-var
  var __stackdStreamManager: StreamManager | undefined;
}

export function getStreamManager(): StreamManager {
  if (!globalThis.__stackdStreamManager) {
    globalThis.__stackdStreamManager = new StreamManager();
  }
  return globalThis.__stackdStreamManager;
}

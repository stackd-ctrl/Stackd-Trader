'use client';

// STACKD TRADER — Realtime data hook.
//
// Subscribes to Supabase realtime channels for signals, bot_status, trades.
// Returns a snapshot of the dashboard state for the current mode. Live prices
// come from a separate /api/prices poll (or, in production, a server-sent
// channel proxied from Alpaca).

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';
import type {
  Anomaly,
  BotStatus,
  DailySummary,
  Signal,
  Trade,
  TradeMode,
} from '@/types/database';

export interface LivePrice {
  instrument: string;
  price: number;
  open: number;
  changePct: number;
  timestamp: string;
}

export interface RealtimeState {
  status: BotStatus | null;
  signals: Signal[];           // latest 20
  trades: Trade[];             // latest 20
  prices: Record<string, LivePrice>;
  anomalies: Anomaly[];        // unacknowledged only
  dailySummary: DailySummary | null;
  loading: boolean;
  error: string | null;
}

const POLL_PRICES_MS = 5000;

export function useRealtimeData(mode: TradeMode): RealtimeState {
  const [status, setStatus]   = useState<BotStatus | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [trades, setTrades]   = useState<Trade[]>([]);
  const [prices, setPrices]   = useState<Record<string, LivePrice>>({});
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Lazy: only construct the client in the browser, after mount. Keeps SSR /
  // prerender from crashing when env isn't set.
  const supabaseRef = useRef<ReturnType<typeof supabaseBrowser> | null>(null);
  function getClient(): ReturnType<typeof supabaseBrowser> | null {
    if (typeof window === 'undefined') return null;
    if (supabaseRef.current) return supabaseRef.current;
    try {
      supabaseRef.current = supabaseBrowser();
      return supabaseRef.current;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }

  // ---- Initial snapshot ----------------------------------------------------
  useEffect(() => {
    const supabase = getClient();
    if (!supabase) { setLoading(false); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [statusRes, signalsRes, tradesRes, anomaliesRes, summaryRes] = await Promise.all([
          supabase.from('bot_status').select('*').eq('mode', mode).single(),
          supabase.from('signals').select('*').eq('mode', mode)
            .order('created_at', { ascending: false }).limit(20),
          supabase.from('trades').select('*').eq('mode', mode)
            .order('entry_time', { ascending: false }).limit(20),
          supabase.from('anomalies').select('*').eq('mode', mode)
            .is('acknowledged_at', null).order('created_at', { ascending: false }).limit(20),
          supabase.from('daily_summaries').select('*').eq('mode', mode).eq('date', today).maybeSingle(),
        ]);
        if (cancelled) return;
        if (statusRes.error)  throw statusRes.error;
        if (signalsRes.error) throw signalsRes.error;
        if (tradesRes.error)  throw tradesRes.error;
        if (anomaliesRes.error) throw anomaliesRes.error;
        if (summaryRes.error) throw summaryRes.error;
        setStatus(statusRes.data ?? null);
        setSignals(signalsRes.data ?? []);
        setTrades(tradesRes.data ?? []);
        setAnomalies(anomaliesRes.data ?? []);
        setDailySummary(summaryRes.data ?? null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ---- Realtime subscriptions ---------------------------------------------
  useEffect(() => {
    const supabase = getClient();
    if (!supabase) return;
    const channel = supabase
      .channel(`dashboard-${mode}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bot_status', filter: `mode=eq.${mode}` },
        (payload) => {
          const next = payload.new as BotStatus | null;
          if (next) setStatus(next);
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'signals', filter: `mode=eq.${mode}` },
        (payload) => {
          const row = payload.new as Signal;
          setSignals((prev) => [row, ...prev].slice(0, 20));
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trades', filter: `mode=eq.${mode}` },
        (payload) => {
          const row = payload.new as Trade;
          setTrades((prev) => {
            const without = prev.filter((t) => t.id !== row.id);
            return [row, ...without].slice(0, 20);
          });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'anomalies', filter: `mode=eq.${mode}` },
        (payload) => {
          const row = payload.new as Anomaly;
          setAnomalies((prev) => {
            const without = prev.filter((a) => a.id !== row.id);
            if (row.acknowledged_at) return without;  // ack'd → drop from list
            return [row, ...without].slice(0, 20);
          });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_summaries', filter: `mode=eq.${mode}` },
        (payload) => {
          const row = payload.new as DailySummary;
          const today = new Date().toISOString().slice(0, 10);
          if (row.date === today) setDailySummary(row);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ---- Live prices: poll /api/prices every 5s -----------------------------
  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch(`/api/prices?mode=${mode}`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { prices: LivePrice[] };
      const next: Record<string, LivePrice> = {};
      for (const p of body.prices) next[p.instrument] = p;
      setPrices(next);
    } catch {
      // Silent; we'll try again on the next tick.
    }
  }, [mode]);

  useEffect(() => {
    void fetchPrices();
    const id = setInterval(fetchPrices, POLL_PRICES_MS);
    return () => clearInterval(id);
  }, [fetchPrices]);

  return { status, signals, trades, prices, anomalies, dailySummary, loading, error };
}

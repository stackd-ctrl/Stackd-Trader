// GET /api/cron/anomaly-check  (Vercel cron: */15 * * * 1-5)

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import { detectAnomalies } from '@/lib/claude/anomaly';
import { getSnapshot, getCandles } from '@/lib/polygon/client';
import { VOLUME_RATIO } from '@/lib/indicators';
import { instrumentsForMode } from '@/lib/instruments';
import { isAuthorizedCron } from '@/lib/cronAuth';
import type { TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function run(): Promise<NextResponse> {
  const mode: TradeMode = 'paper';
  const sb = supabaseService();

  // Pull current state per instrument.
  const prices: Record<string, number> = {};
  const change15m: Record<string, number> = {};
  const volSpikes: Record<string, number> = {};
  const closesByInst: Record<string, number[]> = {};

  for (const inst of instrumentsForMode(mode)) {
    try {
      const snap = await getSnapshot(inst.key);
      prices[inst.key] = snap.price;
      change15m[inst.key] = snap.changePct;  // approximate; Day 4 will compute true 15-min delta
    } catch { /* skip — free-tier limits */ }

    try {
      const candles = await getCandles(inst.key, '5m', 30);
      if (candles.length >= 20) {
        const volumes = candles.map((c) => c.volume);
        volSpikes[inst.key] = VOLUME_RATIO(volumes, 20);
        closesByInst[inst.key] = candles.map((c) => c.close);
      }
    } catch { /* skip */ }
  }

  // Correlation between every pair of instruments where we have closes.
  const corr: Record<string, Record<string, number>> = {};
  const keys = Object.keys(closesByInst);
  for (const a of keys) {
    corr[a] = {};
    for (const b of keys) {
      if (a === b) continue;
      corr[a][b] = pearson(closesByInst[a], closesByInst[b]);
    }
  }

  // Pull regime + recent signal scores + open position count.
  const { data: status } = await sb
    .from('bot_status').select('regime').eq('mode', mode).single();
  const { data: recentSignals } = await sb
    .from('signals').select('total_score').eq('mode', mode)
    .order('created_at', { ascending: false }).limit(10);
  const { count: openCount } = await sb
    .from('trades').select('id', { count: 'exact', head: true })
    .eq('mode', mode).eq('status', 'open');

  const result = await detectAnomalies({
    mode,
    current_prices: prices,
    price_changes_15min: change15m,
    volume_spikes: volSpikes,
    correlation_matrix: corr,
    regime: status?.regime ?? 'ranging',
    recent_signal_scores: (recentSignals ?? []).map((s) => s.total_score),
    open_position_count: openCount ?? 0,
  });

  return NextResponse.json(result);
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return run();
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return run();
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const x = a.slice(-n), y = b.slice(-n);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const xv = x[i] - mx, yv = y[i] - my;
    num += xv * yv;
    dx  += xv * xv;
    dy  += yv * yv;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

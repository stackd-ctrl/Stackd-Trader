// GET /api/execution/status?mode=paper
// Aggregated execution engine state for the dashboard.

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import type { TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const mode = (new URL(req.url).searchParams.get('mode') ?? 'paper') as TradeMode;
  const sb = supabaseService();
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const startIso = startOfDay.toISOString();

  const [statusRes, openCountRes, todaysTradesRes, riskBlocksRes, riskSettingsRes, lastScanRes] = await Promise.all([
    sb.from('bot_status').select('daily_pnl, daily_trades, daily_loss_limit_hit').eq('mode', mode).single(),
    sb.from('trades').select('id', { count: 'exact', head: true }).eq('mode', mode).eq('status', 'open'),
    sb.from('trades').select('id', { count: 'exact', head: true }).eq('mode', mode).gte('entry_time', startIso),
    sb.from('risk_guard_log').select('id', { count: 'exact', head: true })
      .eq('mode', mode).eq('decision', 'blocked').gte('created_at', startIso),
    sb.from('risk_settings').select('daily_loss_limit_pct').eq('mode', mode).single(),
    sb.from('bot_event_log').select('created_at').eq('mode', mode).eq('category', 'signal')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const dailyPnl = statusRes.data?.daily_pnl ?? 0;
  const dailyLimitPct = Number(riskSettingsRes.data?.daily_loss_limit_pct ?? 0);
  // Approximate "% of limit used" against a default 100k paper account.
  // Day 5 will read account equity to refine this.
  const limitDollars = 100_000 * (dailyLimitPct / 100);
  const limitUsedPct = limitDollars > 0 && dailyPnl < 0
    ? Number(((Math.abs(dailyPnl) / limitDollars) * 100).toFixed(2))
    : 0;

  const lastScan = lastScanRes.data?.created_at ?? null;
  const nextScan = lastScan
    ? new Date(new Date(lastScan).getTime() + 60_000).toISOString()
    : new Date(Date.now() + 60_000).toISOString();

  return NextResponse.json({
    positions_open: openCountRes.count ?? 0,
    todays_trades: todaysTradesRes.count ?? 0,
    daily_pnl: dailyPnl,
    daily_loss_limit_pct_used: limitUsedPct,
    daily_loss_limit_hit: statusRes.data?.daily_loss_limit_hit ?? false,
    risk_guard_blocks_today: riskBlocksRes.count ?? 0,
    last_signal_scan: lastScan,
    next_signal_scan: nextScan,
  });
}

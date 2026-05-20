// GET /api/cron/morning  (Vercel cron: 0 13 * * 1-5 → 9:00am ET weekdays)
//
// On run:
//   1. Refresh today's economic calendar
//   2. Refresh news themes
//   3. Classify regime with Claude
//   4. Generate morning brief
//   5. Activate bot for the day (if compliance passes)

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import { refreshWeeklyCalendar, getTodayEvents } from '@/lib/calendar/events';
import { refreshMarketNews } from '@/lib/polygon/news';
import { getSnapshot } from '@/lib/marketData';
import { getAccount } from '@/lib/alpaca/client';
import { regimeTechnicals } from '@/lib/regime/detector';
import { classifyRegimeWithContext } from '@/lib/claude/regime';
import { generateMorningBrief } from '@/lib/claude/morning';
import { instrumentsForMode } from '@/lib/instruments';
import type { OvernightChange } from '@/lib/claude/morning';
import type { TradeMode } from '@/types/database';
import { isAuthorizedCron } from '@/lib/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function run(): Promise<NextResponse> {
  const mode: TradeMode = 'paper';  // Day 4 will dispatch per active mode.
  const sb = supabaseService();

  await refreshWeeklyCalendar();
  await refreshMarketNews();

  const todayEvents = await getTodayEvents();

  // Compute regime from the primary instrument (first crypto for the mode).
  const primary = instrumentsForMode(mode)[0]?.key ?? 'BTC/USD';
  const tech = await regimeTechnicals(primary);

  const intel = await classifyRegimeWithContext({
    mode,
    adx: tech.adx,
    atr: tech.atr,
    atr_20day_avg: tech.atr20DayAvg,
    recent_price_action: tech.recentClose !== null && tech.priorClose !== null
      ? `${primary} last 5m close $${tech.recentClose.toFixed(2)}, prior $${tech.priorClose.toFixed(2)}`
      : 'no recent bars',
    todays_news_themes: [],
    economic_events_today: todayEvents,
    vix_equivalent: null,
  });

  // Overnight price changes for every watched instrument.
  const overnight: OvernightChange[] = [];
  for (const inst of instrumentsForMode(mode)) {
    try {
      const s = await getSnapshot(inst.key);
      overnight.push({
        instrument: inst.key,
        open_yesterday: s.open,
        current_price: s.price,
        change_pct: s.changePct,
      });
    } catch {
      // Polygon free tier 403s for stocks/futures snapshots; skip silently.
    }
  }

  // Account state — Alpaca paper account.
  let balance = 0, dailyPnlYesterday = 0;
  try {
    const acct = await getAccount();
    balance = acct.equity;
    dailyPnlYesterday = acct.last_equity > 0 ? acct.equity - acct.last_equity : 0;
  } catch {
    // Bot can still produce a brief without Alpaca; just zeroes.
  }

  // 7-day win rate from daily_summaries.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: summaries } = await sb
    .from('daily_summaries')
    .select('win_rate,total_trades')
    .eq('mode', mode)
    .gte('date', sevenDaysAgo);
  const traded = (summaries ?? []).filter((s) => s.total_trades > 0);
  const winRate7d = traded.length === 0
    ? 0
    : traded.reduce((sum, s) => sum + s.win_rate, 0) / traded.length / 100;

  const brief = await generateMorningBrief({
    mode,
    overnight_price_changes: overnight,
    premarket_volume: 0,
    economic_events_today: todayEvents,
    recent_news_summary: [],
    current_regime: intel.regime,
    account_status: { balance, daily_pnl_yesterday: dailyPnlYesterday, win_rate_7day: winRate7d },
    topstep_status: null,
  });

  // Auto-activate bot unless brief says sit_out or compliance failed.
  const shouldActivate = brief.bot_recommendation !== 'sit_out';
  if (shouldActivate) {
    await sb.from('bot_status').update({ is_active: true }).eq('mode', mode);
  }

  return NextResponse.json({
    regime: intel.regime,
    brief,
    bot_activated: shouldActivate,
  });
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return run();
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return run();
}

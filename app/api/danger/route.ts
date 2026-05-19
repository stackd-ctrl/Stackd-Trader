// POST /api/danger
// Body: { action: 'reset_daily' | 'clear_signals', confirmation: string, mode?: TradeMode }
//
// Destructive operations. Each action requires a specific confirmation token
// to match (avoid accidental triggers from typos / scripts).

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import type { TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  action?: 'reset_daily' | 'clear_signals';
  confirmation?: string;
  mode?: TradeMode;
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Body;
  const mode: TradeMode = body.mode ?? 'paper';
  const sb = supabaseService();

  if (body.action === 'reset_daily') {
    if (body.confirmation !== 'RESET') {
      return NextResponse.json({ error: 'Confirmation must be exactly RESET' }, { status: 400 });
    }
    const { error } = await sb.from('bot_status').update({
      daily_pnl: 0,
      daily_trades: 0,
      daily_loss_limit_hit: false,
      consecutive_losses: 0,
      paused_until: null,
    }).eq('mode', mode);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await sb.from('bot_event_log').insert({
      mode, level: 'warn', category: 'system',
      message: 'Daily stats RESET via danger zone',
      context: { source: 'dashboard' },
    });
    return NextResponse.json({ ok: true, action: 'reset_daily' });
  }

  if (body.action === 'clear_signals') {
    if (body.confirmation !== 'CLEAR') {
      return NextResponse.json({ error: 'Confirmation must be exactly CLEAR' }, { status: 400 });
    }
    const { error, count } = await sb.from('signals').delete({ count: 'exact' }).eq('mode', mode);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await sb.from('bot_event_log').insert({
      mode, level: 'warn', category: 'system',
      message: `Signals CLEARED via danger zone (${count ?? 0} rows)`,
      context: { source: 'dashboard', deleted: count ?? 0 },
    });
    return NextResponse.json({ ok: true, action: 'clear_signals', deleted: count ?? 0 });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

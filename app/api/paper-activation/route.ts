// POST /api/paper-activation
// Body: { starting_balance: number, mode?: TradeMode }
// One-time activation: sets paper_started_at + paper_starting_balance, flips is_active=true.

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import type { TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  starting_balance?: number;
  mode?: TradeMode;
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Body;
  const mode: TradeMode = body.mode ?? 'paper';
  if (typeof body.starting_balance !== 'number' || body.starting_balance <= 0) {
    return NextResponse.json({ error: 'starting_balance must be positive number' }, { status: 400 });
  }

  const sb = supabaseService();
  const nowIso = new Date().toISOString();
  const { error } = await sb.from('bot_status').update({
    is_active: true,
    paper_started_at: nowIso,
    paper_starting_balance: body.starting_balance,
  }).eq('mode', mode);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sb.from('bot_event_log').insert({
    mode, level: 'info', category: 'system',
    message: 'Paper trading activated',
    context: { starting_balance: body.starting_balance, started_at: nowIso },
  });

  return NextResponse.json({ ok: true, started_at: nowIso });
}

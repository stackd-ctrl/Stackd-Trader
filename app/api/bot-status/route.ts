// GET  /api/bot-status?mode=paper  → current row from bot_status
// POST /api/bot-status?mode=paper  → patch is_active / daily_loss_limit_hit / regime
//
// All writes go through service role so they bypass RLS but stay server-side.

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import type { MarketRegime, TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function modeFromUrl(url: string): TradeMode {
  return ((new URL(url).searchParams.get('mode') ?? 'paper') as TradeMode);
}

export async function GET(req: Request): Promise<NextResponse> {
  const mode = modeFromUrl(req.url);
  const sb = supabaseService();
  const { data, error } = await sb
    .from('bot_status')
    .select('*')
    .eq('mode', mode)
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

interface PatchInput {
  is_active?: boolean;
  daily_loss_limit_hit?: boolean;
  regime?: MarketRegime;
}

export async function POST(req: Request): Promise<NextResponse> {
  const mode = modeFromUrl(req.url);

  let body: PatchInput;
  try {
    body = (await req.json()) as PatchInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const patch: PatchInput = {};
  if (typeof body.is_active === 'boolean')            patch.is_active = body.is_active;
  if (typeof body.daily_loss_limit_hit === 'boolean') patch.daily_loss_limit_hit = body.daily_loss_limit_hit;
  if (typeof body.regime === 'string')                patch.regime = body.regime;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const sb = supabaseService();
  const { data, error } = await sb
    .from('bot_status')
    .update(patch)
    .eq('mode', mode)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Audit log so we can see kill-switch presses in bot_event_log.
  if (typeof body.is_active === 'boolean') {
    await sb.from('bot_event_log').insert({
      mode,
      level: 'info',
      category: 'system',
      message: body.is_active ? 'Bot activated' : 'Bot stopped (kill switch)',
      context: { source: 'dashboard' },
    });
  }

  return NextResponse.json(data);
}

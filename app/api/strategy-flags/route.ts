// GET  /api/strategy-flags?mode=paper
// PATCH /api/strategy-flags?mode=paper  body: { strategy, is_enabled }

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import type { TradeMode, TradeStrategy } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STRATEGIES: TradeStrategy[] = ['momentum', 'mean_reversion', 'news_sentiment'];

function modeFromUrl(url: string): TradeMode {
  return ((new URL(url).searchParams.get('mode') ?? 'paper') as TradeMode);
}

export async function GET(req: Request): Promise<NextResponse> {
  const mode = modeFromUrl(req.url);
  const sb = supabaseService();
  const { data, error } = await sb.from('strategy_flags').select('*').eq('mode', mode);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ flags: data ?? [] });
}

export async function PATCH(req: Request): Promise<NextResponse> {
  const mode = modeFromUrl(req.url);
  const body = (await req.json().catch(() => ({}))) as { strategy?: TradeStrategy; is_enabled?: boolean };
  if (!body.strategy || !STRATEGIES.includes(body.strategy)) {
    return NextResponse.json({ error: 'Invalid strategy' }, { status: 400 });
  }
  if (typeof body.is_enabled !== 'boolean') {
    return NextResponse.json({ error: 'is_enabled must be boolean' }, { status: 400 });
  }
  const sb = supabaseService();
  const { error } = await sb.from('strategy_flags').upsert({
    mode, strategy: body.strategy, is_enabled: body.is_enabled, updated_at: new Date().toISOString(),
  }, { onConflict: 'mode,strategy' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sb.from('bot_event_log').insert({
    mode, level: 'info', category: 'system',
    message: `Strategy ${body.strategy} ${body.is_enabled ? 'enabled' : 'disabled'}`,
    context: { strategy: body.strategy, is_enabled: body.is_enabled },
  });
  return NextResponse.json({ ok: true });
}

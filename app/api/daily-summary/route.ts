// GET  /api/daily-summary?mode=paper  → today's daily_summaries row
// POST /api/daily-summary?mode=paper  body { kind: 'morning' | 'evening' }
//   → marks the corresponding read timestamp.

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import type { TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function modeFromUrl(url: string): TradeMode {
  return ((new URL(url).searchParams.get('mode') ?? 'paper') as TradeMode);
}

export async function GET(req: Request): Promise<NextResponse> {
  const mode = modeFromUrl(req.url);
  const sb = supabaseService();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from('daily_summaries')
    .select('*')
    .eq('mode', mode)
    .eq('date', today)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? null);
}

export async function POST(req: Request): Promise<NextResponse> {
  const mode = modeFromUrl(req.url);
  const body = (await req.json().catch(() => ({}))) as { kind?: 'morning' | 'evening' };
  if (body.kind !== 'morning' && body.kind !== 'evening') {
    return NextResponse.json({ error: 'kind must be morning or evening' }, { status: 400 });
  }
  const sb = supabaseService();
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const patch = body.kind === 'morning'
    ? { morning_read_at: nowIso }
    : { evening_read_at: nowIso };
  const { error } = await sb
    .from('daily_summaries')
    .update(patch)
    .eq('mode', mode)
    .eq('date', today);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

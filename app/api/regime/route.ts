// GET  /api/regime?mode=paper → current regime from bot_status
// POST /api/regime?mode=paper → force re-classification using BTC/USD as proxy

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import { computeRegimeForInstrument, persistRegime } from '@/lib/regime/detector';
import { instrumentsForMode } from '@/lib/instruments';
import { isBlackoutPeriod } from '@/lib/calendar/events';
import type { TradeMode } from '@/types/database';

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
    .select('regime, last_updated, mode')
    .eq('mode', mode)
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(req: Request): Promise<NextResponse> {
  const mode = modeFromUrl(req.url);
  // Use the first instrument for this mode as the regime proxy.
  const primary = instrumentsForMode(mode)[0];
  if (!primary) {
    return NextResponse.json({ error: `No instruments for mode ${mode}` }, { status: 400 });
  }
  try {
    const blackout = await isBlackoutPeriod();
    const cls = await computeRegimeForInstrument(primary.key, { newsEventActive: blackout });
    const persist = await persistRegime(mode, cls);
    return NextResponse.json({
      regime: cls.regime,
      confidence: cls.confidence,
      reasoning: cls.reasoning,
      changed: persist.changed,
      previous: persist.previous,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

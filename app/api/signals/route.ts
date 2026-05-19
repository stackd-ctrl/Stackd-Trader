// GET  /api/signals?mode=paper  → last 20 signals
// POST /api/signals?mode=paper  → trigger manual signal scan

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import { runSignalScan } from '@/lib/signals/generator';
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
    .from('signals')
    .select('*')
    .eq('mode', mode)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ signals: data ?? [] });
}

export async function POST(req: Request): Promise<NextResponse> {
  const mode = modeFromUrl(req.url);
  try {
    const result = await runSignalScan(mode);
    return NextResponse.json({
      generated_count: result.generated.length,
      skipped: result.skipped,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

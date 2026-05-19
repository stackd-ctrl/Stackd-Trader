// POST /api/execution/enter
// Body: { signal_id: string, mode?: TradeMode }
// Pulls a stored signal and runs the full orchestrator → trade path.

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import { processSignal } from '@/lib/execution/orchestrator';
import type { TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Body {
  signal_id?: string;
  mode?: TradeMode;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  if (!body.signal_id) return NextResponse.json({ error: 'signal_id required' }, { status: 400 });
  const mode: TradeMode = body.mode ?? 'paper';

  const sb = supabaseService();
  const { data: signal, error } = await sb.from('signals').select('*').eq('id', body.signal_id).single();
  if (error || !signal) return NextResponse.json({ error: 'signal not found' }, { status: 404 });

  const result = await processSignal(signal, mode);
  return NextResponse.json(result);
}

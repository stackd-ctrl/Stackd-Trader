// GET  /api/anomalies?mode=paper  → unacknowledged anomalies, newest first
// POST /api/anomalies              body { id: string }  → ack the anomaly

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import type { TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const mode = (new URL(req.url).searchParams.get('mode') ?? 'paper') as TradeMode;
  const sb = supabaseService();
  const { data, error } = await sb
    .from('anomalies')
    .select('*')
    .eq('mode', mode)
    .is('acknowledged_at', null)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ anomalies: data ?? [] });
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const sb = supabaseService();
  const { error } = await sb
    .from('anomalies')
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: 'dashboard' })
    .eq('id', body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

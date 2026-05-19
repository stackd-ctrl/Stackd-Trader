// GET  /api/risk-settings?mode=paper       → current row
// PATCH /api/risk-settings?mode=paper      → update specific fields

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import type { TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_FIELDS = [
  'max_risk_per_trade_pct',
  'daily_loss_limit_pct',
  'profit_target_pct',
  'max_contracts',
  'topstep_daily_loss_limit',
  'topstep_max_drawdown',
  'topstep_profit_target',
] as const;

type AllowedField = (typeof ALLOWED_FIELDS)[number];

function modeFromUrl(url: string): TradeMode {
  return ((new URL(url).searchParams.get('mode') ?? 'paper') as TradeMode);
}

export async function GET(req: Request): Promise<NextResponse> {
  const mode = modeFromUrl(req.url);
  const sb = supabaseService();
  const { data, error } = await sb.from('risk_settings').select('*').eq('mode', mode).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(req: Request): Promise<NextResponse> {
  const mode = modeFromUrl(req.url);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: Partial<Record<AllowedField, number>> = {};
  for (const key of ALLOWED_FIELDS) {
    const v = body[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      patch[key] = v;
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields supplied' }, { status: 400 });
  }

  const sb = supabaseService();
  const { data, error } = await sb.from('risk_settings').update(patch).eq('mode', mode).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit log.
  await sb.from('bot_event_log').insert({
    mode, level: 'info', category: 'system',
    message: 'risk_settings updated',
    context: { changes: patch as Record<string, unknown> },
  });

  return NextResponse.json(data);
}

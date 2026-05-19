// POST /api/compliance/approve
// Body: { mode: TradeMode, date: 'YYYY-MM-DD', approved_by?: string }

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import type { TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  mode?: TradeMode;
  date?: string;
  approved_by?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.mode) return NextResponse.json({ error: 'mode required' }, { status: 400 });
  if (!body.date) return NextResponse.json({ error: 'date required' }, { status: 400 });

  const sb = supabaseService();
  const nowIso = new Date().toISOString();
  const { error } = await sb.from('compliance_approvals').upsert({
    mode: body.mode,
    date: body.date,
    morning_approved: true,
    morning_at: nowIso,
    approved_by: body.approved_by ?? 'operator',
  }, { onConflict: 'mode,date' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sb.from('bot_event_log').insert({
    mode: body.mode, level: 'info', category: 'system',
    message: `Morning compliance approved for ${body.date}`,
    context: { approved_by: body.approved_by ?? 'operator' },
  });

  return NextResponse.json({ ok: true, approved_at: nowIso });
}

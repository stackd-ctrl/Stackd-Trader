// GET  /api/cron/evening  (Vercel cron: 30 20 * * 1-5 → 4:30pm ET weekdays)
// POST /api/cron/evening  with header `x-manual-trigger: true` for manual fire

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import { gatherDayDataFromSupabase, generateEveningReport } from '@/lib/claude/evening';
import { isAuthorizedCron } from '@/lib/cronAuth';
import type { TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function run(): Promise<NextResponse> {
  const mode: TradeMode = 'paper';
  const input = await gatherDayDataFromSupabase(mode);
  const report = await generateEveningReport(input);

  // Deactivate bot for the day.
  const sb = supabaseService();
  await sb.from('bot_status').update({ is_active: false }).eq('mode', mode);

  return NextResponse.json({ report, bot_deactivated: true });
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return run();
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return run();
}

// GET  /api/cron/position-monitor  (Vercel cron: */1 * * * * → every minute, 24/7 for crypto)
// POST /api/cron/position-monitor  (manual trigger)

import { NextResponse } from 'next/server';
import { monitorPositions } from '@/lib/execution/positionMonitor';
import { isAuthorizedCron } from '@/lib/cronAuth';
import type { TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function run(): Promise<NextResponse> {
  const mode: TradeMode = 'paper';
  await monitorPositions(mode);
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return run();
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return run();
}

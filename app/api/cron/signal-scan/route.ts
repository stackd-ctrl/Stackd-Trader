// GET  /api/cron/signal-scan  (Vercel cron: * * * * 1-5)
// POST /api/cron/signal-scan  (x-manual-trigger: true)
//
// Runs the full orchestrator: technical scan → Claude sentiment + explanation
// → risk guard → executeEntry. See lib/execution/orchestrator.ts.

import { NextResponse } from 'next/server';
import { runSignalScan } from '@/lib/execution/orchestrator';
import { isAuthorizedCron } from '@/lib/cronAuth';
import type { TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function run(): Promise<NextResponse> {
  const mode: TradeMode = 'paper';
  const result = await runSignalScan(mode);
  return NextResponse.json(result);
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return run();
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return run();
}

// POST /api/execution/closeAll?mode=paper
// Emergency close every open position. Wired to the kill switch.

import { NextResponse } from 'next/server';
import { closeAllPositions } from '@/lib/execution/orderExecutor';
import type { TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request): Promise<NextResponse> {
  const mode = (new URL(req.url).searchParams.get('mode') ?? 'paper') as TradeMode;
  const result = await closeAllPositions(mode, 'kill_switch');
  return NextResponse.json(result);
}

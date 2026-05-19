// POST /api/execution/exit
// Body: { tradeId: string, reason: ExitReason }

import { NextResponse } from 'next/server';
import { executeExit } from '@/lib/execution/orderExecutor';
import type { ExitReason } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VALID_REASONS: ExitReason[] = ['stop_loss', 'take_profit', 'manual', 'end_of_day', 'kill_switch', 'risk_concern', 'strategy_change'];

interface Body {
  tradeId?: string;
  reason?: ExitReason;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  if (!body.tradeId) return NextResponse.json({ error: 'tradeId required' }, { status: 400 });
  if (!body.reason || !VALID_REASONS.includes(body.reason)) {
    return NextResponse.json({ error: `reason must be one of: ${VALID_REASONS.join(', ')}` }, { status: 400 });
  }

  const result = await executeExit(body.tradeId, body.reason);
  return NextResponse.json(result);
}

// POST /api/execution/manual
// Body: { instrument, direction, mode?, tier?, dryRun? }
// Human-initiated trade. dryRun returns computed levels/size without placing.

import { NextResponse } from 'next/server';
import { manualEntry, type ManualEntryInput } from '@/lib/execution/orchestrator';
import type { TradeDirection, TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Body {
  instrument?: string;
  direction?: TradeDirection;
  mode?: TradeMode;
  tier?: 'full' | 'half';
  dryRun?: boolean;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.instrument) return NextResponse.json({ error: 'instrument required' }, { status: 400 });
  if (body.direction !== 'long' && body.direction !== 'short') {
    return NextResponse.json({ error: 'direction must be long or short' }, { status: 400 });
  }

  const input: ManualEntryInput = {
    instrument: body.instrument,
    direction: body.direction,
    mode: body.mode ?? 'paper',
    tier: body.tier === 'half' ? 'half' : 'full',
    dryRun: body.dryRun === true,
  };

  const result = await manualEntry(input);
  const ok = result.status !== 'skipped';
  return NextResponse.json(result, { status: ok ? 200 : 422 });
}

// GET /api/claude-usage
// Aggregates today's Claude call rows for the ClaudeUsage component.

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import type { ClaudeCallType } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Row {
  call_type: ClaudeCallType;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export async function GET(): Promise<NextResponse> {
  const sb = supabaseService();
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);

  const { data, error } = await sb
    .from('claude_calls')
    .select('call_type, input_tokens, output_tokens, cost_usd')
    .gte('created_at', start.toISOString());
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Row[];

  const byTypeMap = new Map<ClaudeCallType, { count: number; input_tokens: number; output_tokens: number; cost_usd: number }>();
  let totalCalls = 0, totalIn = 0, totalOut = 0, totalCost = 0;
  for (const r of rows) {
    totalCalls++;
    totalIn  += r.input_tokens;
    totalOut += r.output_tokens;
    totalCost += Number(r.cost_usd);
    const bucket = byTypeMap.get(r.call_type) ?? { count: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    bucket.count++;
    bucket.input_tokens  += r.input_tokens;
    bucket.output_tokens += r.output_tokens;
    bucket.cost_usd      += Number(r.cost_usd);
    byTypeMap.set(r.call_type, bucket);
  }

  // Project monthly cost based on hours elapsed today.
  const elapsedHours = (Date.now() - start.getTime()) / 3_600_000;
  const dailyProjection = elapsedHours > 0.5 ? (totalCost / elapsedHours) * 24 : totalCost * 24;
  const monthlyProjection = Number((dailyProjection * 30).toFixed(2));

  return NextResponse.json({
    today: {
      calls: totalCalls,
      input_tokens: totalIn,
      output_tokens: totalOut,
      cost_usd: Number(totalCost.toFixed(4)),
    },
    by_type: Array.from(byTypeMap.entries()).map(([call_type, v]) => ({
      call_type,
      ...v,
      cost_usd: Number(v.cost_usd.toFixed(4)),
    })),
    monthly_projection_usd: monthlyProjection,
  });
}

// GET /api/account
// Returns Alpaca account snapshot (balance, buying power, daily P&L).

import { NextResponse } from 'next/server';
import { getAccount } from '@/lib/alpaca/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const acct = await getAccount();
    const dailyPnl = acct.equity - acct.last_equity;
    return NextResponse.json({
      id: acct.id,
      status: acct.status,
      cash: acct.cash,
      buying_power: acct.buying_power,
      portfolio_value: acct.portfolio_value,
      equity: acct.equity,
      last_equity: acct.last_equity,
      daily_pnl: dailyPnl,
      daytrade_count: acct.daytrade_count,
      pattern_day_trader: acct.pattern_day_trader,
      trading_blocked: acct.trading_blocked,
      account_blocked: acct.account_blocked,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

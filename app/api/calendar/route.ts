// GET /api/calendar
// Returns today's high-impact events + the next upcoming event + blackout flag.

import { NextResponse } from 'next/server';
import {
  getNextEvent,
  getTodayEvents,
  isBlackoutPeriod,
  refreshWeeklyCalendar,
} from '@/lib/calendar/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const [today, next, blackout] = await Promise.all([
    getTodayEvents(),
    getNextEvent(),
    isBlackoutPeriod(),
  ]);
  return NextResponse.json({
    today,
    next,
    blackout,
  });
}

// POST /api/calendar  → force refresh from FMP (use sparingly; FMP rate-limited)
export async function POST(): Promise<NextResponse> {
  try {
    const count = await refreshWeeklyCalendar();
    return NextResponse.json({ persisted: count });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

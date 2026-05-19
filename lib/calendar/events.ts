// STACKD TRADER — Economic calendar (FMP free tier).
//
// We fetch the full week, filter to the high-impact events the bot cares
// about, and persist into calendar_events. Blackout check is cheap and runs
// before every trade entry.

import 'server-only';
import { supabaseService } from '@/lib/supabase';
import { BLACKOUT_MINUTES } from '@/lib/constants';
import { isWithinMinutesOf, minutesUntil } from '@/lib/time';
import type { CalendarEvent } from '@/types/database';

export class CalendarError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CalendarError';
    this.status = status;
  }
}

const HIGH_IMPACT_PATTERNS: RegExp[] = [
  /\bFOMC\b/i,
  /\bFederal Reserve\b/i,
  /\bFed Interest Rate\b/i,
  /\bCPI\b/i,
  /\bConsumer Price Index\b/i,
  /\bNon[- ]?Farm Payrolls?\b/i,
  /\bNFP\b/i,
  /\bGDP\b/i,
  /\bPPI\b/i,
  /\bProducer Price Index\b/i,
];

function apiKey(): string {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new CalendarError('Missing FMP_API_KEY', 0);
  return key;
}

function baseUrl(): string {
  return process.env.FMP_BASE_URL ?? 'https://financialmodelingprep.com/api/v3';
}

interface FmpRaw {
  event: string;
  date: string;
  country: string;
  actual: string | number | null;
  estimate: string | number | null;
  previous: string | number | null;
  impact?: string;        // FMP labels "High" | "Medium" | "Low" sometimes
}

function isHighImpact(event: string, impact: string | undefined): boolean {
  if (impact && impact.toLowerCase() === 'high') return true;
  return HIGH_IMPACT_PATTERNS.some((re) => re.test(event));
}

function toIso(dateStr: string): string {
  // FMP returns 'YYYY-MM-DD HH:mm:ss' in UTC. Append Z so JS parses it as UTC.
  const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  return new Date(normalized).toISOString();
}

/** Pull this week's economic calendar from FMP, filter to high-impact events. */
export async function fetchWeeklyHighImpact(): Promise<CalendarEvent[]> {
  const now = new Date();
  const start = now.toISOString().slice(0, 10);
  const endDate = new Date(now);
  endDate.setUTCDate(endDate.getUTCDate() + 7);
  const end = endDate.toISOString().slice(0, 10);

  const url = `${baseUrl()}/economic_calendar?from=${start}&to=${end}&apikey=${apiKey()}`;

  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (cause) {
    throw new CalendarError(`Network error: ${(cause as Error).message}`, 0);
  }
  if (res.status === 429) throw new CalendarError('FMP rate limit hit', 429);
  if (!res.ok) throw new CalendarError(`FMP ${res.status}`, res.status);

  const raw = (await res.json()) as FmpRaw[];
  const filtered = raw.filter((r) => isHighImpact(r.event, r.impact));

  return filtered.map((r) => ({
    id: '',  // assigned by DB
    event: r.event,
    country: r.country ?? null,
    impact: 'high' as const,
    scheduled_at: toIso(r.date),
    actual: r.actual === null || r.actual === undefined ? null : String(r.actual),
    forecast: r.estimate === null || r.estimate === undefined ? null : String(r.estimate),
    previous: r.previous === null || r.previous === undefined ? null : String(r.previous),
    created_at: new Date().toISOString(),
  }));
}

/** Persist into Supabase. Dedupes on (event, scheduled_at). */
export async function persistEvents(events: CalendarEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const sb = supabaseService();
  const rows = events.map(({ id: _id, created_at: _ca, ...rest }) => rest);
  const { error, count } = await sb
    .from('calendar_events')
    .upsert(rows, { onConflict: 'event,scheduled_at', count: 'exact', ignoreDuplicates: true });
  if (error) {
    console.error('[calendar] persist failed', error);
    return 0;
  }
  return count ?? rows.length;
}

/**
 * Refresh once on startup (or on a daily cron). Pulls weekly events, filters,
 * persists, and returns the persisted set.
 */
export async function refreshWeeklyCalendar(): Promise<number> {
  try {
    const events = await fetchWeeklyHighImpact();
    return await persistEvents(events);
  } catch (err) {
    console.error('[calendar] refresh failed', err);
    return 0;
  }
}

// ---- Public read API -------------------------------------------------------

export async function getTodayEvents(): Promise<CalendarEvent[]> {
  const sb = supabaseService();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const { data, error } = await sb
    .from('calendar_events')
    .select('*')
    .eq('impact', 'high')
    .gte('scheduled_at', start.toISOString())
    .lt('scheduled_at', end.toISOString())
    .order('scheduled_at', { ascending: true });
  if (error) {
    console.error('[calendar] getTodayEvents failed', error);
    return [];
  }
  return data ?? [];
}

export async function getNextEvent(): Promise<CalendarEvent | null> {
  const sb = supabaseService();
  const { data, error } = await sb
    .from('calendar_events')
    .select('*')
    .eq('impact', 'high')
    .gte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(1);
  if (error) {
    console.error('[calendar] getNextEvent failed', error);
    return null;
  }
  return data?.[0] ?? null;
}

/**
 * Returns true if we are within ±BLACKOUT_MINUTES of any high-impact event.
 * Bot MUST check this before every trade entry.
 */
export async function isBlackoutPeriod(): Promise<boolean> {
  const sb = supabaseService();
  const windowStart = new Date(Date.now() - BLACKOUT_MINUTES * 60 * 1000);
  const windowEnd = new Date(Date.now() + BLACKOUT_MINUTES * 60 * 1000);

  const { data, error } = await sb
    .from('calendar_events')
    .select('scheduled_at')
    .eq('impact', 'high')
    .gte('scheduled_at', windowStart.toISOString())
    .lte('scheduled_at', windowEnd.toISOString())
    .limit(1);
  if (error) {
    // Fail safe: assume blackout on DB error so we don't trade through a hole.
    console.error('[calendar] isBlackoutPeriod failed; failing safe', error);
    return true;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Pure helper used by tests + the signal generator when we already have the
 * next-event timestamp in memory.
 */
export function isBlackoutForEvent(scheduledIso: string): boolean {
  return isWithinMinutesOf(scheduledIso, BLACKOUT_MINUTES);
}

export function minutesUntilNext(scheduledIso: string): number {
  return minutesUntil(scheduledIso);
}

// STACKD TRADER — Eastern-time helpers.
// All market-hours decisions go through this module so we have one place to fix
// DST quirks and one place to mock in tests.

const ET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hour12: false,
});

export interface ETNow {
  /** 0..23 in Eastern time. */
  hour: number;
  /** 0..59 in Eastern time. */
  minute: number;
  /** 0 = Sun, 1 = Mon ... 6 = Sat. */
  weekday: number;
  /** Total minutes since midnight ET. */
  minutesOfDay: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export function nowET(now: Date = new Date()): ETNow {
  const parts = ET_FMT.formatToParts(now);
  let hour = 0;
  let minute = 0;
  let weekday = 0;
  for (const p of parts) {
    if (p.type === 'hour') hour = Number(p.value) % 24;
    else if (p.type === 'minute') minute = Number(p.value);
    else if (p.type === 'weekday') weekday = WEEKDAY_INDEX[p.value] ?? 0;
  }
  return { hour, minute, weekday, minutesOfDay: hour * 60 + minute };
}

// Signal scan window: skip the first 15 min of the cash session and the last
// 15 min of the close (most volatile, worst slippage).
const MARKET_OPEN_MIN = 9 * 60 + 45;   // 09:45 ET
const MARKET_CLOSE_MIN = 15 * 60 + 45; // 15:45 ET

export function isMarketHours(now: Date = new Date()): boolean {
  const t = nowET(now);
  if (t.weekday === 0 || t.weekday === 6) return false;
  return t.minutesOfDay >= MARKET_OPEN_MIN && t.minutesOfDay <= MARKET_CLOSE_MIN;
}

/** Crypto trades 24/7 — used by the crypto-only scan loop. */
export function isCryptoSession(): boolean {
  return true;
}

export function minutesUntil(targetIso: string, now: Date = new Date()): number {
  return Math.round((new Date(targetIso).getTime() - now.getTime()) / 60000);
}

export function isWithinMinutesOf(targetIso: string, mins: number, now: Date = new Date()): boolean {
  const diff = Math.abs(minutesUntil(targetIso, now));
  return diff <= mins;
}

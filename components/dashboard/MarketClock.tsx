'use client';

// STACKD TRADER — Live ET clock + market session badge.

import { useEffect, useState } from 'react';

const ET_TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});

type Session = 'pre_market' | 'open' | 'closed' | 'futures_open';

function sessionFor(now: Date): Session {
  const parts = ET_PARTS.formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const minutesOfDay = hour * 60 + minute;
  const isWeekday = !['Sat', 'Sun'].includes(weekday);

  // Cash equities: 9:30am-4:00pm ET.
  if (isWeekday && minutesOfDay >= 9 * 60 + 30 && minutesOfDay < 16 * 60) return 'open';
  if (isWeekday && minutesOfDay >= 4 * 60 && minutesOfDay < 9 * 60 + 30)  return 'pre_market';

  // CME futures: Sun 6pm ET → Fri 5pm ET, with daily 5-6pm maintenance break.
  // Outside cash hours but within futures window → futures_open.
  const inFuturesWindow = (() => {
    if (weekday === 'Sat') return false;
    if (weekday === 'Sun' && minutesOfDay < 18 * 60) return false;
    if (weekday === 'Fri' && minutesOfDay >= 17 * 60) return false;
    // 5-6pm ET daily maintenance.
    if (minutesOfDay >= 17 * 60 && minutesOfDay < 18 * 60) return false;
    return true;
  })();
  if (inFuturesWindow) return 'futures_open';

  return 'closed';
}

const SESSION_STYLE: Record<Session, { color: string; bg: string; border: string; label: string; pulse: boolean }> = {
  pre_market:   { color: 'text-muted',   bg: 'bg-bg/40',     border: 'border-line',         label: 'PRE-MARKET',   pulse: false },
  open:         { color: 'text-success', bg: 'bg-success/10', border: 'border-success/40',   label: 'OPEN',         pulse: true  },
  futures_open: { color: 'text-accent',  bg: 'bg-accent/10',  border: 'border-accent/40',    label: 'FUTURES OPEN', pulse: true  },
  closed:       { color: 'text-muted',   bg: 'bg-bg/40',     border: 'border-line',         label: 'CLOSED',       pulse: false },
};

export function MarketClock() {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const session = sessionFor(now);
  const style = SESSION_STYLE[session];

  return (
    <div className="flex items-center gap-2">
      <div className="num text-sm text-ink/85 tracking-wider">{ET_TIME_FMT.format(now)} ET</div>
      <span className={['inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] uppercase tracking-[0.18em] font-medium',
        style.color, style.bg, style.border].join(' ')}>
        <span className={['h-1.5 w-1.5 rounded-full', style.color.replace('text-', 'bg-'), style.pulse ? 'animate-pulse' : ''].join(' ')} />
        {style.label}
      </span>
    </div>
  );
}

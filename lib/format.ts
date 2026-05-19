// STACKD TRADER — formatting helpers (no em dashes anywhere in copy).

export function formatUSD(value: number, opts: { signed?: boolean } = {}): string {
  const sign = opts.signed && value > 0 ? '+' : '';
  const abs = Math.abs(value);
  const body = abs.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
  return value < 0 ? `-${body}` : `${sign}${body}`;
}

export function formatPct(value: number, digits = 1): string {
  return `${value >= 0 ? '' : ''}${value.toFixed(digits)}%`;
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--';
  return value.toFixed(1);
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

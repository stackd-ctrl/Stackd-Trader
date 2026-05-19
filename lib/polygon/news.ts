// STACKD TRADER — Polygon news client.
//
// Fetch headlines, normalize, persist into the `news` table. Claude reads
// these rows later for sentiment scoring. The 5-minute polling loop is run
// out-of-band (cron, route handler, or scheduled action) — this file just
// exposes pure fetch + persist helpers.

import 'server-only';
import { supabaseService } from '@/lib/supabase';
import { instrumentByKey } from '@/lib/instruments';

export interface NewsHeadline {
  title: string;
  summary: string | null;
  url: string | null;
  source: string | null;
  sentiment_score: number | null;
  published_at: string;
}

export class NewsError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'NewsError';
    this.status = status;
    this.body = body;
  }
}

function apiKey(): string {
  const key = process.env.POLYGON_API_KEY;
  if (!key) throw new NewsError('Missing POLYGON_API_KEY', 0, null);
  return key;
}

function baseUrl(): string {
  return process.env.POLYGON_BASE_URL ?? 'https://api.polygon.io';
}

async function fetchNews(params: Record<string, string | number>): Promise<NewsHeadline[]> {
  const qs = new URLSearchParams({ apiKey: apiKey(), order: 'desc', sort: 'published_utc' });
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const url = `${baseUrl()}/v2/reference/news?${qs.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (cause) {
    throw new NewsError('Network error calling Polygon news', 0, cause);
  }
  if (res.status === 429) throw new NewsError('Polygon news rate limit hit', 429, null);
  if (!res.ok) {
    const body = await res.text().catch(() => null);
    throw new NewsError(`Polygon news ${res.status}`, res.status, body);
  }

  type Raw = {
    results?: Array<{
      title?: string;
      description?: string;
      article_url?: string;
      publisher?: { name?: string };
      published_utc?: string;
      insights?: Array<{ sentiment?: string; sentiment_reasoning?: string }>;
    }>;
  };
  const raw = (await res.json()) as Raw;

  return (raw.results ?? []).map((r) => ({
    title: r.title ?? '',
    summary: r.description ?? null,
    url: r.article_url ?? null,
    source: r.publisher?.name ?? null,
    sentiment_score: parseSentiment(r.insights),
    published_at: r.published_utc ?? new Date().toISOString(),
  }));
}

function parseSentiment(
  insights?: Array<{ sentiment?: string }>,
): number | null {
  if (!insights || insights.length === 0) return null;
  const map: Record<string, number> = { positive: 1, neutral: 0, negative: -1 };
  const scores = insights
    .map((i) => (i.sentiment ? map[i.sentiment.toLowerCase()] : undefined))
    .filter((v): v is number => typeof v === 'number');
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

// ---- Public API -------------------------------------------------------------

/** Last 10 news items for a specific instrument. */
export async function getRecentNews(instrument: string): Promise<NewsHeadline[]> {
  const ticker = instrumentByKey(instrument)?.polygonTicker ?? instrument;
  // News API expects unprefixed tickers for stocks/crypto/futures. Strip Polygon namespaces.
  const clean = ticker.replace(/^[A-Z]:/, '');
  return fetchNews({ ticker: clean, limit: 10 });
}

/** Last 10 general market news items. */
export async function getMarketNews(): Promise<NewsHeadline[]> {
  return fetchNews({ limit: 10 });
}

/**
 * Persist headlines to Supabase `news` table. Dedupes on URL via the unique
 * constraint in migration 002. Safe to run on the 5-minute polling tick.
 */
export async function persistNews(
  items: NewsHeadline[],
  instrument: string | null,
): Promise<number> {
  if (items.length === 0) return 0;
  const sb = supabaseService();
  const rows = items
    .filter((i) => i.title && i.url)
    .map((i) => ({
      instrument,
      title: i.title,
      summary: i.summary,
      url: i.url,
      source: i.source,
      sentiment_score: i.sentiment_score,
      published_at: i.published_at,
    }));
  if (rows.length === 0) return 0;
  const { error, count } = await sb
    .from('news')
    .upsert(rows, { onConflict: 'url', count: 'exact', ignoreDuplicates: true });
  if (error) {
    console.error('[news] persist failed', error);
    return 0;
  }
  return count ?? rows.length;
}

/**
 * Convenience: fetch + persist in one call. Returns count of new rows.
 * Wraps in try/catch so a transient API failure doesn't crash the loop.
 */
export async function refreshNewsForInstrument(instrument: string): Promise<number> {
  try {
    const items = await getRecentNews(instrument);
    return await persistNews(items, instrument);
  } catch (err) {
    console.error(`[news] refresh failed for ${instrument}`, err);
    return 0;
  }
}

export async function refreshMarketNews(): Promise<number> {
  try {
    const items = await getMarketNews();
    return await persistNews(items, null);
  } catch (err) {
    console.error('[news] market refresh failed', err);
    return 0;
  }
}

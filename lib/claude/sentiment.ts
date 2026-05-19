// STACKD TRADER — News sentiment scoring via Claude.
//
// Returns a -10..10 sentiment score for a list of headlines on one instrument.
// Cached for 5 minutes per instrument (news doesn't move that fast and the
// signal loop runs every 60s).

import 'server-only';
import { callClaude } from './client';
import { withTimeout } from './timeout';
import { getRecentNews, type NewsHeadline } from '@/lib/polygon/news';

const HARD_BUDGET_MS = 3_000;

export interface SentimentResult {
  score: number;               // -10 .. 10
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;          // 0 .. 1
  key_factors: string[];       // max 3
  trading_relevance: 'high' | 'medium' | 'low';
}

const FALLBACK: SentimentResult = {
  score: 0,
  direction: 'neutral',
  confidence: 0,
  key_factors: [],
  trading_relevance: 'low',
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score:        { type: 'number', minimum: -10, maximum: 10 },
    direction:    { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
    confidence:   { type: 'number', minimum: 0, maximum: 1 },
    key_factors:  { type: 'array', items: { type: 'string' }, maxItems: 3 },
    trading_relevance: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['score', 'direction', 'confidence', 'key_factors', 'trading_relevance'],
};

const SYSTEM_PROMPT = [
  'You are a quantitative trading sentiment analyst.',
  'You analyze financial news and return precise sentiment scores.',
  'You are objective, data-focused, and never speculative.',
  'You respond only in the exact JSON format requested.',
  'Never use em dashes.',
].join(' ');

// ---- 5-minute cache, keyed on instrument ----------------------------------

interface CacheEntry { at: number; value: SentimentResult }
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function fromCache(instrument: string): SentimentResult | null {
  const hit = cache.get(instrument);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_MS) {
    cache.delete(instrument);
    return null;
  }
  return hit.value;
}

// ---- Public API ------------------------------------------------------------

export async function scoreNewsSentiment(
  headlinesIn: NewsHeadline[] | null | undefined,
  instrument: string,
): Promise<SentimentResult> {
  return withTimeout(
    _scoreNewsSentimentInner(headlinesIn, instrument),
    HARD_BUDGET_MS,
    FALLBACK,
    `sentiment:${instrument}`,
  );
}

async function _scoreNewsSentimentInner(
  headlinesIn: NewsHeadline[] | null | undefined,
  instrument: string,
): Promise<SentimentResult> {
  // If caller didn't pass headlines, pull them.
  const headlines = headlinesIn && headlinesIn.length > 0
    ? headlinesIn
    : await getRecentNews(instrument).catch(() => [] as NewsHeadline[]);

  if (headlines.length === 0) return FALLBACK;

  const cached = fromCache(instrument);
  if (cached) return cached;

  const formatted = headlines
    .slice(0, 10)
    .map((h, i) => {
      const date = new Date(h.published_at).toISOString().slice(0, 16).replace('T', ' ');
      const body = h.summary ? `: ${h.summary}` : '';
      return `${i + 1}. [${date}] ${h.title}${body}`;
    })
    .join('\n');

  const userMessage = [
    `Analyze these news headlines for ${instrument} and return a sentiment score.`,
    '',
    'Headlines:',
    formatted,
    '',
    'Return only this JSON, no other text:',
    '{',
    '  "score": number between -10 and 10,',
    '  "direction": "bullish" or "bearish" or "neutral",',
    '  "confidence": number between 0 and 1,',
    '  "key_factors": array of max 3 strings explaining the score,',
    '  "trading_relevance": "high" or "medium" or "low"',
    '}',
  ].join('\n');

  const result = await callClaude<SentimentResult>({
    callType: 'sentiment',
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxTokens: 500,
    schema: SCHEMA,
    fallback: FALLBACK,
    logContext: { instrument, headline_count: headlines.length },
  });

  // Cache only successful calls so we re-try after a failure.
  if (result.success) cache.set(instrument, { at: Date.now(), value: result.parsed });
  return result.parsed;
}

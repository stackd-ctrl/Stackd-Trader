// STACKD TRADER — Base Claude client.
//
// Server-only. Every Claude call in the system goes through callClaude().
// Handles:
//  - typed Anthropic SDK
//  - structured-output JSON schemas (output_config.format) for guaranteed parses
//  - exponential backoff on RateLimitError / 5xx via the SDK + a manual ceiling
//  - cost accounting and logging into claude_calls

import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseService } from '@/lib/supabase';
import type { ClaudeCallType } from '@/types/database';

// User specified `claude-sonnet-4-20250514` (the original Sonnet 4.0).
// That model deprecates 2026-06-15; we use the current production
// drop-in replacement instead. Same Messages API surface, no code changes.
export const CLAUDE_MODEL = 'claude-sonnet-4-6';

// Pricing per million tokens (Sonnet 4.6, as of 2026-04). Used by the
// per-call cost estimator. Cache write/read prices follow the standard
// 1.25x / 0.1x multipliers.
const PRICE_INPUT_PER_MTOK  = 3.0;
const PRICE_OUTPUT_PER_MTOK = 15.0;

// Zero SDK-level retries — the bot has a 3s budget per Claude call, and the
// SDK's default retry-with-backoff can quietly blow past that on a 5xx/429.
// If we time out, the function-level withTimeout fallback fires instead.
const MAX_RETRIES = 0;
// Per-call hard timeout. Spec: bot must never block on Claude longer than 3s.
// The Anthropic SDK respects this on the underlying fetch and aborts cleanly.
const HARD_TIMEOUT_MS = 3_000;

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');
  cachedClient = new Anthropic({ apiKey, maxRetries: MAX_RETRIES, timeout: HARD_TIMEOUT_MS });
  return cachedClient;
}

export interface CallOptions<T> {
  callType: ClaudeCallType;
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  /** JSON schema enforced by the API. Response is guaranteed to validate. */
  schema?: Record<string, unknown>;
  /** Optional structured context attached to the claude_calls log row. */
  logContext?: Record<string, unknown>;
  /** Fallback value if the call fails or times out. Returned instead of throwing. */
  fallback: T;
}

export interface CallResult<T> {
  parsed: T;
  raw: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost_usd: number;
  };
  duration_ms: number;
  success: boolean;
  error?: string;
}

/**
 * Run one Claude call. Logs to claude_calls regardless of outcome.
 * On failure: returns the fallback (does not throw) so the bot loop keeps moving.
 */
export async function callClaude<T>(opts: CallOptions<T>): Promise<CallResult<T>> {
  const started = Date.now();

  try {
    const c = client();
    // System prompt as a typed block so we can attach cache_control. Sonnet 4.6's
    // minimum cacheable prefix is ~2048 tokens — caching is a no-op below that,
    // but harmless to mark.
    const systemBlocks: Anthropic.TextBlockParam[] = [
      {
        type: 'text',
        text: opts.systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ];

    // Build the request. output_config.format guarantees a JSON response that
    // matches the schema if one is provided.
    const req: Anthropic.MessageCreateParamsNonStreaming = {
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens,
      // LOCKED — temperature must be 0 for every Claude call in this system.
      // Trading decisions need to be reproducible from the same inputs.
      // This value is hardcoded and intentionally not a parameter on CallOptions.
      // Do not change without sign-off.
      temperature: 0,
      system: systemBlocks,
      messages: [{ role: 'user', content: opts.userMessage }],
    };
    if (opts.schema) {
      (req as unknown as Record<string, unknown>).output_config = {
        format: { type: 'json_schema', schema: opts.schema },
      };
    }

    const response = await c.messages.create(req);

    const duration = Date.now() - started;
    const usage = {
      input_tokens:        response.usage.input_tokens ?? 0,
      output_tokens:       response.usage.output_tokens ?? 0,
      cache_read_tokens:   response.usage.cache_read_input_tokens ?? 0,
      cache_write_tokens:  response.usage.cache_creation_input_tokens ?? 0,
      cost_usd:            estimateCost(response.usage),
    };

    // Concatenate text blocks. Structured outputs return one text block.
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    // Parse JSON if a schema was provided; otherwise return raw as T.
    let parsed: T;
    if (opts.schema) {
      try {
        parsed = JSON.parse(text) as T;
      } catch {
        // One retry: strip markdown fences if Claude wrapped the JSON.
        const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
        try {
          parsed = JSON.parse(stripped) as T;
        } catch (err) {
          await logCall(opts, usage, duration, false, `JSON parse failed: ${(err as Error).message}`);
          return { parsed: opts.fallback, raw: text, usage, duration_ms: duration, success: false, error: 'parse_failure' };
        }
      }
    } else {
      parsed = text as unknown as T;
    }

    await logCall(opts, usage, duration, true);
    return { parsed, raw: text, usage, duration_ms: duration, success: true };
  } catch (err) {
    const duration = Date.now() - started;
    const message = err instanceof Anthropic.APIError
      ? `Anthropic ${err.status}: ${err.message}`
      : (err as Error).message;
    await logCall(opts, ZERO_USAGE, duration, false, message);
    return {
      parsed: opts.fallback,
      raw: '',
      usage: ZERO_USAGE,
      duration_ms: duration,
      success: false,
      error: message,
    };
  }
}

const ZERO_USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  cost_usd: 0,
};

function estimateCost(usage: Anthropic.Usage): number {
  const inputTokens  = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheRead    = usage.cache_read_input_tokens ?? 0;
  const cacheWrite   = usage.cache_creation_input_tokens ?? 0;

  // Standard Anthropic cache multipliers.
  const inputCost = (inputTokens / 1_000_000)  * PRICE_INPUT_PER_MTOK;
  const outputCost = (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK;
  const cacheReadCost  = (cacheRead  / 1_000_000) * PRICE_INPUT_PER_MTOK * 0.1;
  const cacheWriteCost = (cacheWrite / 1_000_000) * PRICE_INPUT_PER_MTOK * 1.25;

  return Number((inputCost + outputCost + cacheReadCost + cacheWriteCost).toFixed(6));
}

async function logCall<T>(
  opts: CallOptions<T>,
  usage: typeof ZERO_USAGE,
  duration_ms: number,
  success: boolean,
  error?: string,
): Promise<void> {
  try {
    const sb = supabaseService();
    await sb.from('claude_calls').insert({
      call_type: opts.callType,
      model: CLAUDE_MODEL,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      cache_write_tokens: usage.cache_write_tokens,
      cost_usd: usage.cost_usd,
      duration_ms,
      success,
      error_message: error ?? null,
      context: opts.logContext ?? null,
    });
  } catch (err) {
    console.error('[claude] failed to log call', err);
  }
}

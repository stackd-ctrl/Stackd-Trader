// STACKD TRADER — shared constants used by both UI and the bot scoring loop.
// Keep these in one place so the displayed action and the executed action agree.

/**
 * Signal scoring scale (Day 2):
 *   Each of the 7 factors scores 0..10 then gets weighted (see SIGNAL_WEIGHTS).
 *   Non-sentiment factors max out at 90 points; sentiment adds 10 more.
 *   Final scale is 0..100.
 */

/** Per-factor weights. Sum to 100 so total_score is 0..100. */
export const SIGNAL_WEIGHTS = {
  rsi: 20,
  macd: 20,
  volume: 15,
  keyLevel: 15,
  atr: 10,
  regime: 10,
  sentiment: 10,
} as const;

export const NON_SENTIMENT_MAX = 90;
export const TOTAL_MAX = 100;

/** Raw (pre-Claude) gate: signal must clear this to be sent to Claude. */
export const RAW_THRESHOLD = 58.5;

/** Final gate: total_score must clear this to fire as ENTER. (Day 1 was 6.5/10.) */
export const ENTER_THRESHOLD = 65;

/**
 * Effective action for a given total_score on the 0..100 scale.
 * Scores under the threshold always render as SKIP, no matter what the row
 * claims, so the UI and execution path stay in sync.
 */
export function effectiveAction(totalScore: number): 'enter' | 'skip' {
  return totalScore >= ENTER_THRESHOLD ? 'enter' : 'skip';
}

/** Economic-calendar blackout window (minutes either side of a high-impact event). */
export const BLACKOUT_MINUTES = 30;

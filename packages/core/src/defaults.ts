import { MIN, localMidnight } from './time';

/** Default length range for programs: skips stray shorts and multi-hour files in a show folder. */
export const DEFAULT_PROGRAM_MIN_MS = 5 * MIN;
export const DEFAULT_PROGRAM_MAX_MS = 90 * MIN;
export const PROGRAM_RANGE = { minDurationMs: DEFAULT_PROGRAM_MIN_MS, maxDurationMs: DEFAULT_PROGRAM_MAX_MS };

/** Where a new channel's timeline starts: today at local midnight, so the first preview day is full. */
export function newChannelAnchorMs(now = Date.now()): number {
  return localMidnight(now);
}

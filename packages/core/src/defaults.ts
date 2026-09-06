import { MIN, localMidnight } from './time';

/** Default length range for programs: skips stray shorts and multi-hour files in a show folder. */
export const DEFAULT_PROGRAM_MIN_MS = 5 * MIN;
export const DEFAULT_PROGRAM_MAX_MS = 90 * MIN;
export const PROGRAM_RANGE = { minDurationMs: DEFAULT_PROGRAM_MIN_MS, maxDurationMs: DEFAULT_PROGRAM_MAX_MS };

/**
 * Where a new channel's timeline starts: the half hour that is playing right now. The guide is blank
 * before that rather than showing a day of invented history, and the first block is one the user picked.
 */
export function newChannelAnchorMs(now = Date.now()): number {
  const half = 30 * MIN;
  return localMidnight(now) + Math.floor((now - localMidnight(now)) / half) * half;
}

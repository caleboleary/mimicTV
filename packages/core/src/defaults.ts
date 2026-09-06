import type { Channel, Clock, Pool } from './types';
import { HOUR, MIN, localMidnight } from './time';

/** Default length range for programs: skips stray shorts and multi-hour files in a show folder. */
export const DEFAULT_PROGRAM_MIN_MS = 5 * MIN;
export const DEFAULT_PROGRAM_MAX_MS = 90 * MIN;
export const PROGRAM_RANGE = { minDurationMs: DEFAULT_PROGRAM_MIN_MS, maxDurationMs: DEFAULT_PROGRAM_MAX_MS };

/** Where a new channel's timeline starts: today at local midnight, so the first preview day is full. */
export function newChannelAnchorMs(now = Date.now()): number {
  return localMidnight(now);
}

/** Sensible first pools/clocks/channels for a freshly imported library, keyed off root-folder tags. */
export function starterRules(library: import('./types').Library): { pools: Pool[]; clocks: Clock[]; channels: Channel[] } {
  const byKind = (k: import('./types').MediaKind) => library.items.filter((i) => i.kind === k);
  const rootTagsFor = (k: import('./types').MediaKind) => [...new Set(byKind(k).map((i) => i.tags[1]).filter((t): t is string => !!t))];

  const pools: Pool[] = [];
  const programPools: { pool: Pool; avgMs: number }[] = [];
  for (const kind of ['episode', 'movie'] as const) {
    for (const tag of rootTagsFor(kind)) {
      const items = byKind(kind).filter((i) => i.tags[1] === tag);
      const pool: Pool = {
        id: `pool-${kind}-${tag}`, name: `${tag} (${kind === 'episode' ? 'shows' : 'movies'})`,
        filter: { kinds: [kind], tags: [tag], excludeTags: kind === 'episode' ? ['unnumbered', 'special', 'extra'] : undefined, ...(kind === 'episode' ? PROGRAM_RANGE : {}) },
        selection: kind === 'episode' ? 'shows-shuffled-episodes-in-order' : 'shuffle',
      };
      pools.push(pool);
      programPools.push({ pool, avgMs: items.reduce((n, i) => n + i.durationMs, 0) / Math.max(1, items.length) });
    }
  }
  const ads: Pool = { id: 'pool-commercials', name: 'Commercials', filter: { kinds: ['commercial'] }, selection: 'random', noRepeatMs: 2 * HOUR };
  const ids: Pool = { id: 'pool-ids', name: 'Network IDs', filter: { kinds: ['network-id'] }, selection: 'shuffle' };
  const filler: Pool = { id: 'pool-filler', name: 'Filler', filter: { kinds: ['filler'] }, selection: 'random', noRepeatMs: 30 * MIN };
  pools.push(ads, ids, filler);

  const clocks: Clock[] = [];
  const channels: Channel[] = [];
  const anchorMs = newChannelAnchorMs();
  programPools.forEach(({ pool, avgMs }, i) => {
    const hour = avgMs > 35 * MIN;
    const targetMs = hour ? Math.min(Math.round(avgMs / MIN) * MIN, 110 * MIN) : avgMs > 15 * MIN ? 22 * MIN : 22 * MIN;
    const clock: Clock = {
      id: `clock-${pool.id}`, name: `${pool.name} ${hour ? 'hour' : 'half hour'}`,
      program: { poolId: pool.id, targetMs, toleranceMs: hour ? 8 * MIN : 4 * MIN, allowMultiple: avgMs < 15 * MIN },
      breaks: { atChapters: true, poolId: ads.id, equalize: true, midTargetMs: 2 * MIN, maxItems: 0 },
      networkId: { enabled: byKind('network-id').length > 0, poolId: ids.id, nearMinutes: [0, 30], windowMs: 3 * MIN },
      pad: { toMinutes: avgMs > 60 * MIN ? 60 : 30, poolId: filler.id },
    };
    clocks.push(clock);
    channels.push({
      id: `ch-${pool.id}`, number: String(i + 1), name: pool.name.replace(/ \(.*\)$/, ''), tvgId: `mimic.${i + 1}`, group: 'mimicTV',
      dayparts: [{ startMinute: 0, clockId: clock.id }], anchorMs, seed: `ch-${pool.id}`,
    });
  });
  return { pools, clocks, channels };
}

import type { Channel, Clock, Pool } from './types';
import { HOUR, MIN } from './time';

export function defaultPools(): Pool[] {
  return [
    { id: 'pool-sitcoms', name: 'Sitcoms', description: 'Shuffle shows, keep each show in order', filter: { kinds: ['episode'], tags: ['sitcom'] }, selection: 'shows-shuffled-episodes-in-order' },
    { id: 'pool-cartoons', name: 'Cartoons', description: '11-minute shorts', filter: { kinds: ['episode'], tags: ['cartoon'] }, selection: 'shows-shuffled-episodes-in-order' },
    { id: 'pool-drama', name: 'Hour Dramas', filter: { kinds: ['episode'], tags: ['drama'] }, selection: 'shows-shuffled-episodes-in-order' },
    { id: 'pool-ads-90s', name: 'Commercials: 90s', description: 'Random, no repeat within 2h', filter: { kinds: ['commercial'], tags: ['90s'] }, selection: 'random', noRepeatMs: 2 * HOUR },
    { id: 'pool-ads-all', name: 'Commercials: all eras', filter: { kinds: ['commercial'] }, selection: 'random', noRepeatMs: HOUR },
    { id: 'pool-ids', name: 'Network IDs', filter: { kinds: ['network-id'] }, selection: 'shuffle' },
    { id: 'pool-static', name: 'Static Card', description: 'Still image, stretches to any length', filter: { kinds: ['filler'], tags: ['still'] }, selection: 'random' },
    { id: 'pool-glitch', name: 'Glitch Loops', description: 'Trimmable clips', filter: { kinds: ['filler'], tags: ['glitch'] }, selection: 'random', noRepeatMs: 30 * MIN },
  ];
}

export function defaultClocks(): Clock[] {
  return [
    {
      id: 'clock-sitcom-30', name: 'Sitcom Half Hour',
      program: { poolId: 'pool-sitcoms', targetMs: 22 * MIN, toleranceMs: 4 * MIN, allowMultiple: true },
      breaks: { atChapters: true, poolId: 'pool-ads-90s', equalize: true, midTargetMs: 2 * MIN, maxItems: 0 },
      networkId: { enabled: true, poolId: 'pool-ids', nearMinutes: [0, 30], windowMs: 3 * MIN },
      pad: { toMinutes: 30, poolId: 'pool-glitch' },
      bug: { path: '/media/branding/bug.png', hideDuringBreaks: true },
    },
    {
      id: 'clock-cartoon-30', name: 'Cartoon Half Hour',
      program: { poolId: 'pool-cartoons', targetMs: 22 * MIN, toleranceMs: 3 * MIN, allowMultiple: true },
      breaks: { atChapters: true, poolId: 'pool-ads-all', equalize: true, midTargetMs: 90 * 1000, maxItems: 4 },
      networkId: { enabled: true, poolId: 'pool-ids', nearMinutes: [0, 30], windowMs: 3 * MIN },
      pad: { toMinutes: 30, poolId: 'pool-static' },
    },
    {
      id: 'clock-drama-60', name: 'Drama Hour',
      program: { poolId: 'pool-drama', targetMs: 44 * MIN, toleranceMs: 6 * MIN, allowMultiple: false },
      breaks: { atChapters: true, poolId: 'pool-ads-90s', equalize: false, midTargetMs: 150 * 1000, maxItems: 0 },
      networkId: { enabled: true, poolId: 'pool-ids', nearMinutes: [0], windowMs: 3 * MIN },
      pad: { toMinutes: 60, poolId: 'pool-glitch' },
      bug: { path: '/media/branding/bug.png', hideDuringBreaks: true },
    },
  ];
}

export function defaultAnchorMs(): number {
  // Local 2026-09-01 06:00
  return new Date(2026, 8, 1, 6, 0, 0, 0).getTime();
}

export function defaultChannels(): Channel[] {
  const anchorMs = defaultAnchorMs();
  return [
    {
      id: 'ch-retro', number: '1', name: 'Retro Sitcoms', tvgId: 'mimic.retro', group: 'mimicTV',
      logo: '/media/branding/retro.png',
      dayparts: [{ startMinute: 0, clockId: 'clock-sitcom-30' }],
      anchorMs, seed: 'ch-retro',
    },
    {
      id: 'ch-toons', number: '2', name: 'Toon Block', tvgId: 'mimic.toons', group: 'mimicTV',
      logo: '/media/branding/toons.png',
      dayparts: [
        { startMinute: 6 * 60, clockId: 'clock-cartoon-30' },
        { startMinute: 20 * 60, clockId: 'clock-drama-60' },
      ],
      anchorMs, seed: 'ch-toons',
    },
  ];
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
        filter: { kinds: [kind], tags: [tag], excludeTags: kind === 'episode' ? ['unnumbered', 'special', 'extra'] : undefined },
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
  const anchorMs = defaultAnchorMs();
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

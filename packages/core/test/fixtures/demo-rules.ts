/** Demo pools, clocks, and channels that match the stub library. Test-only. */
import type { Channel, Clock, Pool } from '../../src/types';
import { HOUR, MIN } from '../../src/time';
import { PROGRAM_RANGE } from '../../src/defaults';

export function defaultPools(): Pool[] {
  return [
    { id: 'pool-sitcoms', name: 'Sitcoms', description: 'Shuffle shows, keep each show in order', filter: { kinds: ['episode'], tags: ['sitcom'], ...PROGRAM_RANGE }, selection: 'shows-shuffled-episodes-in-order' },
    { id: 'pool-cartoons', name: 'Cartoons', description: '11-minute shorts', filter: { kinds: ['episode'], tags: ['cartoon'], ...PROGRAM_RANGE }, selection: 'shows-shuffled-episodes-in-order' },
    { id: 'pool-drama', name: 'Hour Dramas', filter: { kinds: ['episode'], tags: ['drama'], ...PROGRAM_RANGE }, selection: 'shows-shuffled-episodes-in-order' },
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

/**
 * One test per row of the scenario table in docs/design-notes.md.
 * Rows that work are asserted against the stub library; open rows are `it.todo` so
 * `npm test` doubles as the roadmap. Keep the numbering in sync with the doc.
 */
import { describe, it, expect } from 'vitest';
import {
  buildStubLibrary, defaultChannels, defaultClocks, defaultPools, simulate, toPlayout, blocksInWindow,
  DAY, HOUR, MIN, SEC,
} from '../src/index';
import type { Channel, Clock, Library, MediaItem, Pool, Ruleset, ScheduledBlock } from '../src/index';

const library = buildStubLibrary();
const base: Ruleset = { library, pools: defaultPools(), clocks: defaultClocks() };
const [retro, toons] = defaultChannels() as [Channel, Channel];

const sitcomClock = base.clocks.find((c) => c.id === 'clock-sitcom-30')!;
type ClockPatch = Omit<Partial<Clock>, 'breaks' | 'pad' | 'program'> & { breaks?: Partial<Clock['breaks']>; pad?: Partial<Clock['pad']>; program?: Partial<Clock['program']> };
const withClock = (patch: ClockPatch, from = sitcomClock): Clock => ({
  ...from, ...patch, id: 'clock-test',
  program: { ...from.program, ...patch.program },
  breaks: { ...from.breaks, ...patch.breaks },
  pad: { ...from.pad, ...patch.pad },
});
const channelWith = (clock: Clock, ch = retro): Channel => ({ ...ch, dayparts: [{ startMinute: 0, clockId: clock.id }] });
const run = (clock: Clock, extraPools: Pool[] = [], hours = 6, ch = retro, lib: Library = library) => {
  const rs: Ruleset = { library: lib, pools: [...base.pools, ...extraPools], clocks: [...base.clocks, clock] };
  const channel = channelWith(clock, ch);
  const sim = simulate(channel, rs, channel.anchorMs + hours * HOUR);
  return { sim, rs, channel, blocks: blocksInWindow(sim, channel.anchorMs, channel.anchorMs + hours * HOUR) };
};
const firstPrograms = (blocks: ScheduledBlock[]) => blocks.map((b) => b.programs[0]!);
const showPool = (id: string, showIds: string[], extra: Partial<Pool> = {}): Pool => ({
  id, name: id, filter: { kinds: ['episode'], showIds, ...extra.filter }, selection: 'shows-shuffled-episodes-in-order', ...extra,
});

describe('scenario table', () => {
  it('1. cartoon block: shuffled shows in order, 22-min slots, breaks at chapters, IDs near :00/:30, pad to :30', () => {
    const sim = simulate(toons, base, toons.anchorMs + 6 * HOUR);
    const blocks = sim.blocks.filter((b) => b.clockId === 'clock-cartoon-30');
    expect(blocks.length).toBeGreaterThan(5);
    for (const b of blocks) {
      expect(new Date(b.end).getMinutes() % 30).toBe(0);
      expect(b.programs.every((p) => library.shows.find((s) => s.id === p.showId)?.tags.includes('cartoon'))).toBe(true);
    }
    expect(blocks.some((b) => b.entries.some((e) => e.role === 'network-id'))).toBe(true);
    expect(blocks.some((b) => b.breaks.some((k) => k.kind === 'mid'))).toBe(true);
  });

  it('2. one-show marathon plays in episode order', () => {
    const pool = showPool('pool-marathon', ['parkside']);
    const { blocks } = run(withClock({ program: { poolId: pool.id, allowMultiple: false } }), [pool], 8);
    const eps = firstPrograms(blocks);
    expect(eps.every((e) => e.showId === 'parkside')).toBe(true);
    for (let i = 1; i < eps.length; i++) {
      const a = eps[i - 1]!, b = eps[i]!;
      expect(a.season! * 100 + a.episode!).toBeLessThan(b.season! * 100 + b.episode!);
    }
  });

  it('3. two shows strictly alternate', () => {
    const pool = showPool('pool-two', ['parkside', 'night-shift']);
    const { blocks } = run(withClock({ program: { poolId: pool.id, allowMultiple: false } }), [pool], 8);
    const shows = firstPrograms(blocks).map((e) => e.showId);
    for (let i = 1; i < shows.length; i++) expect(shows[i]).not.toBe(shows[i - 1]);
  });

  it('4. dayparts: cartoons by day, drama at night', () => {
    const sim = simulate(toons, base, toons.anchorMs + DAY);
    const at = (h: number) => sim.blocks.find((b) => b.start <= toons.anchorMs + h * HOUR && b.end > toons.anchorMs + h * HOUR)!.clockId;
    expect(at(2)).toBe('clock-cartoon-30');   // 08:00
    expect(at(16)).toBe('clock-drama-60');    // 22:00
  });

  it('5. replicate a channel: same rules, new seed gives a different order with the same shape', () => {
    const a = simulate(retro, base, retro.anchorMs + 6 * HOUR);
    const b = simulate({ ...retro, seed: 'other' }, base, retro.anchorMs + 6 * HOUR);
    expect(a.blocks.map((x) => x.end)).toEqual(b.blocks.map((x) => x.end));
    expect(firstPrograms(a.blocks).map((e) => e.id)).not.toEqual(firstPrograms(b.blocks).map((e) => e.id));
  });

  it('6. channel bug on programs, off during breaks', () => {
    const sim = simulate(retro, base, retro.anchorMs + 2 * HOUR);
    const playout = toPlayout(sim.blocks, { clocks: base.clocks });
    const byId = new Map(sim.blocks.flatMap((b) => b.entries).map((e) => [e.id, e]));
    for (const item of playout.items) {
      const e = byId.get(item.id)!;
      expect(!!item.graphics?.length).toBe(e.role === 'program');
    }
  });

  it.todo('7. off-air overnight: a band that is only a static card, no shows, no ads (needs a "nothing" program option)');

  it('8. back to back, no ads, no padding: blocks end when content ends', () => {
    const clock = withClock({ pad: { toMinutes: 0 }, breaks: { atChapters: false, fallback: { mode: 'none' } }, networkId: { ...sitcomClock.networkId, enabled: false } });
    const { blocks } = run(clock, [], 4);
    expect(blocks.length).toBeGreaterThan(3);
    for (const b of blocks) {
      expect(b.end - b.start).toBe(b.contentMs);
      expect(b.entries.every((e) => e.role === 'program')).toBe(true);
    }
    for (let i = 1; i < blocks.length; i++) expect(blocks[i]!.start).toBe(blocks[i - 1]!.end);
  });

  it('9. break every N minutes when an episode has no chapters', () => {
    const pool = showPool('pool-nochap', ['bad-neighbors']); // half its episodes lack break points
    const { blocks } = run(withClock({ program: { poolId: pool.id, allowMultiple: false }, breaks: { fallback: { mode: 'interval', everyMs: 8 * MIN } } }), [pool], 8);
    const noChapters = blocks.filter((b) => b.programs[0]!.breakPoints.length === 0);
    expect(noChapters.length).toBeGreaterThan(0);
    for (const b of noChapters) expect(b.breaks.filter((k) => k.kind === 'mid').length).toBe(2); // 22 min / 8 = cuts at 8 and 16
  });

  it('10. two episodes of the same show, then switch', () => {
    const pool = showPool('pool-runs', ['parkside', 'night-shift', 'the-larsons'], { runLength: 2 });
    const { blocks } = run(withClock({ program: { poolId: pool.id, allowMultiple: false } }), [pool], 12);
    const shows = firstPrograms(blocks).map((e) => e.showId);
    for (let i = 0; i + 1 < shows.length; i += 2) expect(shows[i]).toBe(shows[i + 1]);
    expect(new Set(shows).size).toBeGreaterThan(1);
  });

  it('11. only seasons 1 to 2 of a show', () => {
    const pool = showPool('pool-seasons', ['the-larsons'], { filter: { seasons: { min: 1, max: 2 } } });
    const { blocks } = run(withClock({ program: { poolId: pool.id } }), [pool], 12);
    const eps = blocks.flatMap((b) => b.programs);
    expect(eps.length).toBeGreaterThan(5);
    expect(eps.every((e) => e.season! <= 2)).toBe(true);
  });

  it('12. music videos: a break after every 4 clips', () => {
    const clips: MediaItem[] = Array.from({ length: 40 }, (_, i) => ({
      id: `mv-${i}`, kind: 'episode', title: `Video ${i}`, path: `/media/music/v${i}.mp4`, durationMs: (3 * MIN) + (i % 5) * 20 * SEC,
      showId: 'videos', season: 1, episode: i + 1, tags: [], breakPoints: [], breakSource: 'none',
    }));
    const lib: Library = { shows: [...library.shows, { id: 'videos', title: 'Videos', year: 2000, tags: [] }], items: [...library.items, ...clips] };
    const pool: Pool = { id: 'pool-mv', name: 'mv', filter: { showIds: ['videos'] }, selection: 'sequential' };
    const clock = withClock({
      program: { poolId: pool.id, targetMs: 27 * MIN, toleranceMs: 3 * MIN, allowMultiple: true },
      breaks: { atChapters: false, fallback: { mode: 'none' }, betweenPrograms: 4, minSegmentMs: 0 },
    });
    const { blocks } = run(clock, [pool], 3, retro, lib);
    for (const b of blocks) {
      expect(b.programs.length).toBeGreaterThanOrEqual(7);
      const mids = b.breaks.filter((k) => k.kind === 'mid').length;
      expect(mids).toBe(Math.floor((b.programs.length - 1) / 4));
    }
  });

  describe('bumpers', () => {
    const bumpers: Pool = { id: 'pool-bumpers', name: 'bumpers', filter: { kinds: ['bumper'] }, selection: 'shuffle' };
    it('13. bumper into every break and bumper out after the ID', () => {
      const { blocks } = run(withClock({ breaks: { bumpers: { before: bumpers.id, after: bumpers.id } } }), [bumpers], 3);
      const breaks = blocks.flatMap((b) => b.breaks).filter((k) => k.entries.length > 0);
      expect(breaks.length).toBeGreaterThan(3);
      for (const k of breaks) {
        expect(k.entries[0]!.role).toBe('bumper');
        expect(k.entries[k.entries.length - 1]!.role).toBe('bumper');
        const id = k.entries.findIndex((e) => e.role === 'network-id');
        if (id >= 0) expect(id).toBe(k.entries.length - 2); // ID stays just before the bumper out
        expect(k.end - k.start).toBe(k.targetMs); // bumpers came out of the budget, not added to it
      }
    });
    it('14. "coming up next" only in the break after a program ends, not at chapter cuts', () => {
      const { blocks } = run(withClock({ breaks: { bumpers: { afterProgram: bumpers.id } } }), [bumpers], 3);
      for (const b of blocks) {
        const segs = b.entries.filter((e) => e.role === 'program');
        for (const k of b.breaks) {
          const prev = segs.filter((e) => e.end <= k.start).pop()!;
          const endsProgram = prev.partIndex === prev.partCount! - 1;
          expect(k.entries[0]?.role === 'bumper').toBe(endsProgram);
        }
      }
    });
  });

  it('15. ads themed to an era: a channel-wide 90s-only commercial pool via saved search', () => {
    const ads: Pool = { id: 'pool-90s-search', name: '90s', filter: { kinds: ['commercial'], any: [{ folder: '/media/commercials/90s' }] }, selection: 'random', noRepeatMs: HOUR };
    const { blocks } = run(withClock({ breaks: { poolId: ads.id } }), [ads], 6);
    const played = blocks.flatMap((b) => b.entries).filter((e) => e.role === 'commercial');
    expect(played.length).toBeGreaterThan(20);
    expect(played.every((e) => e.item.path.startsWith('/media/commercials/90s/'))).toBe(true);
  });
  it('15b. ads follow the show: one show uses the 80s pool, the rest use the channel pool', () => {
    const eighties: Pool = { id: 'pool-80s', name: '80s', filter: { kinds: ['commercial'], any: [{ folder: '/media/commercials/80s' }] }, selection: 'random', noRepeatMs: HOUR };
    const pool = showPool('pool-two-b', ['parkside', 'the-larsons']);
    const clock = withClock({ program: { poolId: pool.id, allowMultiple: false }, breaks: { poolId: 'pool-ads-90s', overrides: [{ showIds: ['the-larsons'], poolId: eighties.id }] } });
    const { blocks } = run(clock, [pool, eighties], 8);
    expect(new Set(blocks.map((b) => b.programs[0]!.showId)).size).toBe(2);
    for (const b of blocks) {
      const ads = b.entries.filter((e) => e.role === 'commercial');
      expect(ads.length).toBeGreaterThan(0);
      const era = b.programs[0]!.showId === 'the-larsons' ? '80s' : '90s';
      expect(ads.every((e) => e.item.path.includes(`/commercials/${era}/`))).toBe(true);
    }
  });

  describe('16. a fixed show at 18:00 every day, whatever else is on', () => {
    const simpsons = showPool('pool-fixed', ['parkside']);
    const fixedClock: Clock = { ...sitcomClock, id: 'clock-fixed', program: { ...sitcomClock.program, poolId: simpsons.id } };
    const at = (day: number, h: number, m = 0) => new Date(2026, 8, 1 + day, h, m).getTime();

    it('plays that show at 18:00 and hands back afterwards', () => {
      const ch: Channel = { ...retro, dayparts: [{ startMinute: 0, clockId: sitcomClock.id }, { startMinute: 18 * 60, endMinute: 18 * 60 + 30, clockId: fixedClock.id }] };
      const rs: Ruleset = { ...base, pools: [...base.pools, simpsons], clocks: [...base.clocks, fixedClock] };
      const sim = simulate(ch, rs, ch.anchorMs + 3 * DAY);
      for (const day of [0, 1, 2]) {
        const b = sim.blocks.find((x) => x.start === at(day, 18))!;
        expect(b).toBeDefined();
        expect(b.clockId).toBe('clock-fixed');
        expect(b.end).toBe(at(day, 18, 30));
        expect(b.programs.every((e) => e.showId === 'parkside')).toBe(true);
        expect(sim.blocks.find((x) => x.start === at(day, 18, 30))!.clockId).toBe(sitcomClock.id);
      }
    });

    it('clamps the block before it, even when the base format pads to the hour', () => {
      const drama = base.clocks.find((c) => c.id === 'clock-drama-60')!;
      const ch: Channel = { ...retro, dayparts: [{ startMinute: 0, clockId: drama.id }, { startMinute: 18 * 60 + 30, endMinute: 19 * 60, clockId: fixedClock.id }] };
      const rs: Ruleset = { ...base, pools: [...base.pools, simpsons], clocks: [...base.clocks, fixedClock] };
      const sim = simulate(ch, rs, ch.anchorMs + DAY);
      const before = sim.blocks.find((x) => x.start < at(0, 18, 30) && x.end > at(0, 18))!;
      expect(before.end).toBe(at(0, 18, 30)); // a 44-min drama can't fit in 18:00-18:30, so the gap is padded
      expect(before.entries.every((e) => e.role !== 'program')).toBe(true);
      expect(sim.blocks.find((x) => x.start === at(0, 18, 30))!.clockId).toBe('clock-fixed');
      expect(sim.blocks.find((x) => x.start === at(0, 19))!.clockId).toBe(drama.id);
    });
  });
  it.todo('17. Saturday-morning-only band (needs day-of-week on dayparts)');
  it.todo('18. holiday specials only in December (needs date windows on pools)');
  it.todo('19. east/west feeds: same channel shifted 3h (needs a channel time offset)');
  it.todo('20. reset a show cursor or jump to S03E01 from the UI (state exists; needs editing UI)');
  it.todo('21. cross-channel no-repeat for commercials (needs shared last-played across channels)');
  it.todo('22. live ad selection at playback via Next dynamic sources');
});

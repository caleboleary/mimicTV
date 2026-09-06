import { describe, it, expect } from 'vitest';
import {
  itemMatches, libraryFolders, candidateCuts, buildStubLibrary, defaultChannels, defaultClocks, defaultPools, simulate, entriesInWindow,
  toPlayout, playoutFileName, programmesFor, toXmltv, DAY, MIN, distanceToBoundary,
} from '../src/index';
import type { Ruleset } from '../src/index';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from '../schema/playout-0.0.3.json';

const ruleset: Ruleset = { library: buildStubLibrary(), pools: defaultPools(), clocks: defaultClocks() };
const [retro, toons] = defaultChannels();

describe('stub library', () => {
  it('has shows, ads, ids, and filler', () => {
    const kinds = new Set(ruleset.library.items.map((i) => i.kind));
    expect([...kinds].sort()).toEqual(['bumper', 'commercial', 'episode', 'filler', 'network-id']);
    expect(ruleset.library.shows.length).toBe(8);
  });
});

describe('simulate', () => {
  const sim = simulate(retro!, ruleset, retro!.anchorMs + 2 * DAY);

  it('produces a contiguous, gapless timeline', () => {
    const entries = sim.blocks.flatMap((b) => b.entries);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.start).toBe(entries[i - 1]!.end);
    }
    expect(sim.cursors.asOf).toBeGreaterThanOrEqual(retro!.anchorMs + 2 * DAY);
  });

  it('lands every block on a 30-minute boundary', () => {
    for (const b of sim.blocks) {
      expect(new Date(b.end).getMinutes() % 30).toBe(0);
      expect(new Date(b.end).getSeconds()).toBe(0);
    }
  });

  it('equalizes breaks within a block', () => {
    const withMids = sim.blocks.filter((b) => b.breaks.length > 1);
    expect(withMids.length).toBeGreaterThan(0);
    for (const b of withMids) {
      const lens = b.breaks.map((x) => x.end - x.start);
      expect(Math.max(...lens) - Math.min(...lens)).toBeLessThanOrEqual(200);
    }
  });

  it('puts the network ID last when a break ends near :00/:30', () => {
    let seen = 0;
    for (const b of sim.blocks) {
      for (const brk of b.breaks) {
        const ids = brk.entries.filter((e) => e.role === 'network-id');
        if (brk.nearBoundary && ids.length === 1) {
          seen++;
          expect(brk.entries[brk.entries.length - 1]!.role).toBe('network-id');
        }
        if (!brk.nearBoundary) expect(ids.length).toBe(0);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('keeps each show in episode order over time', () => {
    const byShow = new Map<string, string[]>();
    for (const e of sim.blocks.flatMap((b) => b.entries)) {
      if (e.role !== 'program' || e.partIndex !== 0) continue;
      const arr = byShow.get(e.item.showId!) ?? [];
      arr.push(`${e.item.season}x${e.item.episode}`);
      byShow.set(e.item.showId!, arr);
    }
    for (const [show, eps] of byShow) {
      expect(eps.length, show).toBeGreaterThan(1);
      const all = ruleset.library.items.filter((i) => i.showId === show).sort((a, b) => (a.season! - b.season!) || (a.episode! - b.episode!)).map((i) => `${i.season}x${i.episode}`);
      expect(eps).toEqual(all.slice(0, eps.length));
    }
  });

  it('is deterministic and resumable', () => {
    const a = simulate(retro!, ruleset, retro!.anchorMs + 2 * DAY);
    const b1 = simulate(retro!, ruleset, retro!.anchorMs + DAY);
    const b2 = simulate(retro!, ruleset, retro!.anchorMs + 2 * DAY, b1);
    expect(b2.blocks.map((x) => x.entries.map((e) => e.item.id))).toEqual(a.blocks.map((x) => x.entries.map((e) => e.item.id)));
  });

  it('honors dayparts', () => {
    const t = simulate(toons!, ruleset, toons!.anchorMs + DAY);
    const evening = t.blocks.filter((b) => new Date(b.start).getHours() >= 20);
    const morning = t.blocks.filter((b) => new Date(b.start).getHours() >= 6 && new Date(b.start).getHours() < 12);
    expect(evening.every((b) => b.clockId === 'clock-drama-60')).toBe(true);
    expect(morning.every((b) => b.clockId === 'clock-cartoon-30')).toBe(true);
  });
});

describe('segment and stacking rules', () => {
  it('ignores break points too close to the start or end', () => {
    const lib = buildStubLibrary();
    const ep = lib.items.find((i) => i.kind === 'episode')!;
    ep.breakPoints = [40 * 1000, 8 * MIN, ep.durationMs - 30 * 1000];
    const pools = defaultPools(); const clocks = defaultClocks();
    pools[0]!.filter = { kinds: ['episode'], showIds: [ep.showId!] };
    pools[0]!.selection = 'sequential';
    const sim = simulate(retro!, { library: lib, pools, clocks }, retro!.anchorMs + 2 * 60 * MIN);
    const first = sim.blocks[0]!;
    expect(first.programs[0]!.id).toBe(ep.id);
    expect(first.entries.filter((e) => e.role === 'program').length).toBe(2);
  });

  it('only stacks a second program when it fits the slot', () => {
    const t = simulate(toons!, ruleset, toons!.anchorMs + DAY);
    for (const b of t.blocks.filter((x) => x.clockId === 'clock-cartoon-30')) {
      expect(b.contentMs).toBeLessThanOrEqual(25 * MIN);
    }
  });
});

describe('emitters', () => {
  const sim = simulate(retro!, ruleset, retro!.anchorMs + DAY);
  const dayEntries = entriesInWindow(sim, retro!.anchorMs, retro!.anchorMs + DAY);
  const dayBlocks = sim.blocks.filter((b) => b.end > retro!.anchorMs && b.start < retro!.anchorMs + DAY);

  it('produces playout JSON that validates against the 0.0.3 schema', () => {
    const playout = toPlayout(dayBlocks, { clocks: ruleset.clocks, generatedAt: retro!.anchorMs });
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const ok = validate(playout);
    if (!ok) console.error(validate.errors);
    expect(ok).toBe(true);
    expect(playout.items.length).toBe(dayEntries.length);
    const ids = new Set(playout.items.map((i) => i.id));
    expect(ids.size).toBe(playout.items.length);
  });

  it('uses in/out points for chapter segments and omits the bug on breaks', () => {
    const playout = toPlayout(dayBlocks, { clocks: ruleset.clocks });
    const seg = playout.items.find((i) => i.source && 'in_point_ms' in i.source && i.source.in_point_ms);
    expect(seg).toBeDefined();
    const ad = playout.items.find((i) => i.id.endsWith('-2'));
    expect(ad?.graphics).toBeUndefined();
    expect(playout.items[0]!.graphics?.length).toBe(1);
  });

  it('names files the way Next expects', () => {
    const name = playoutFileName(retro!.anchorMs, retro!.anchorMs + DAY);
    expect(name).toMatch(/^\d{8}T\d{6}\.\d{9}[+-]\d{4}_\d{8}T\d{6}\.\d{9}[+-]\d{4}\.json$/);
  });

  it('writes XMLTV with one programme per program', () => {
    const progs = programmesFor(dayBlocks, ruleset.library);
    const xml = toXmltv(retro!, progs);
    expect(xml).toContain('<programme start=');
    expect(xml).toContain('<episode-num system="xmltv_ns">');
    expect(progs.length).toBe(dayBlocks.reduce((n, b) => n + b.programs.length, 0));
  });
});

describe('time', () => {
  it('measures distance to :00/:30', () => {
    const t = new Date(2026, 8, 1, 12, 28, 0).getTime();
    expect(distanceToBoundary(t, [0, 30])).toBe(2 * MIN);
    expect(distanceToBoundary(new Date(2026, 8, 1, 12, 59, 0).getTime(), [0, 30])).toBe(MIN);
  });
});

describe('pool duration range', () => {
  const base = { id: 'x', kind: 'episode' as const, title: 't', path: '/t', tags: [], breakPoints: [], breakSource: 'none' as const };
  it('drops items outside min/max and leaves stills alone', () => {
    const f = { minDurationMs: 5 * MIN, maxDurationMs: 90 * MIN };
    expect(itemMatches({ ...base, durationMs: 1 * MIN }, f)).toBe(false);
    expect(itemMatches({ ...base, durationMs: 22 * MIN }, f)).toBe(true);
    expect(itemMatches({ ...base, durationMs: 120 * MIN }, f)).toBe(false);
    expect(itemMatches({ ...base, kind: 'filler', durationMs: 0, still: true }, f)).toBe(true);
  });
  it('is unlimited when unset', () => {
    expect(itemMatches({ ...base, durationMs: 1 * MIN }, {})).toBe(true);
    expect(itemMatches({ ...base, durationMs: 300 * MIN }, {})).toBe(true);
  });
});

describe('saved searches', () => {
  const base = { kind: 'commercial' as const, tags: [], breakPoints: [], breakSource: 'none' as const, durationMs: 30000 };
  const nike = { ...base, id: 'a', title: 'Nike Air', path: '/media/commercials/90s/Nike_Air.mp4' };
  const pepsi = { ...base, id: 'b', title: 'Pepsi', path: '/media/commercials/80s/Pepsi.mp4' };
  const nikeAd2000 = { ...base, id: 'c', title: 'nike freestyle', path: '/media/commercials/2000s/nike.mp4' };
  it('matches every word against title and path, case-insensitively', () => {
    expect(itemMatches(nike, { text: 'NIKE' })).toBe(true);
    expect(itemMatches(nike, { text: 'nike 90s' })).toBe(true);
    expect(itemMatches(pepsi, { text: 'nike' })).toBe(false);
  });
  it('restricts to a folder prefix', () => {
    expect(itemMatches(nike, { folder: '/media/commercials/90s' })).toBe(true);
    expect(itemMatches(nike, { folder: '/media/commercials/90' })).toBe(false);
    expect(itemMatches(nike, { folder: '/media/commercials/' })).toBe(true);
  });
  it("ORs rows in any, under the pool's scope", () => {
    const f = { kinds: ['commercial' as const], any: [{ text: 'nike', folder: '/media/commercials/90s' }, { folder: '/media/commercials/80s' }] };
    expect(itemMatches(nike, f)).toBe(true);
    expect(itemMatches(pepsi, f)).toBe(true);
    expect(itemMatches(nikeAd2000, f)).toBe(false);
    expect(itemMatches({ ...nike, kind: 'filler' }, f)).toBe(false);
    expect(itemMatches(nikeAd2000, { ...f, any: [{ text: '', folder: '' }] })).toBe(true);
  });
  it('lists folders with counts inside a scope', () => {
    const lib = { shows: [], items: [nike, pepsi, nikeAd2000] };
    const folders = libraryFolders(lib, { kinds: ['commercial'] });
    expect(folders.map((f) => f.path)).toEqual(['/media/commercials', '/media/commercials/2000s', '/media/commercials/80s', '/media/commercials/90s']);
    expect(folders[0]!.count).toBe(3);
  });
});

describe('break fallback', () => {
  const base = { id: 'e', kind: 'episode' as const, title: 't', path: '/t', tags: [], breakSource: 'chapters' as const, durationMs: 44 * MIN };
  const withChapters = { ...base, breakPoints: [10 * MIN, 21 * MIN, 33 * MIN] };
  const noChapters = { ...base, breakPoints: [], breakSource: 'none' as const };
  const breaks = (atChapters: boolean, fallback?: any) => ({ atChapters, fallback, poolId: '', equalize: true, midTargetMs: 0, maxItems: 0 });
  it('prefers chapters when honored and present', () => {
    expect(candidateCuts(withChapters, breaks(true, { mode: 'interval', everyMs: 11 * MIN }))).toEqual([10 * MIN, 21 * MIN, 33 * MIN]);
  });
  it('falls back to an interval when chapters are missing', () => {
    expect(candidateCuts(noChapters, breaks(true, { mode: 'interval', everyMs: 11 * MIN }))).toEqual([11 * MIN, 22 * MIN, 33 * MIN]);
  });
  it('uses offsets inside the episode only', () => {
    expect(candidateCuts(noChapters, breaks(true, { mode: 'offsets', offsetsMs: [9 * MIN, 20 * MIN, 50 * MIN] }))).toEqual([9 * MIN, 20 * MIN]);
  });
  it('ignores chapters when not honored', () => {
    expect(candidateCuts(withChapters, breaks(false, { mode: 'interval', everyMs: 22 * MIN }))).toEqual([22 * MIN]);
    expect(candidateCuts(withChapters, breaks(false))).toEqual([]);
    expect(candidateCuts(noChapters, breaks(true))).toEqual([]);
  });
  it('fills a long break with more than 24 commercials when the budget allows', () => {
    const clocks = defaultClocks().map((c) => c.id === 'clock-drama-60' ? { ...c, breaks: { ...c.breaks, atChapters: false, fallback: { mode: 'none' as const } } } : c);
    const rs = { ...ruleset, clocks };
    const sim = simulate({ ...toons!, dayparts: [{ startMinute: 0, clockId: 'clock-drama-60' }] }, rs, toons!.anchorMs + 3 * 60 * MIN);
    const post = sim.blocks[0]!.breaks[0]!;
    const ads = post.entries.filter((e) => e.role === 'commercial');
    expect(post.entries.length).toBeGreaterThan(0);
    expect(ads.length).toBeGreaterThan(24);
  });
});

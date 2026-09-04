import { describe, it, expect } from 'vitest';
import {
  buildStubLibrary, defaultChannels, defaultClocks, defaultPools, simulate, entriesInWindow,
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
    expect([...kinds].sort()).toEqual(['commercial', 'episode', 'filler', 'network-id']);
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

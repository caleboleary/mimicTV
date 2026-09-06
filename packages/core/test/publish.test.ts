import { describe, it, expect } from 'vitest';
import { buildStubLibrary, defaultChannels, defaultClocks, defaultPools, planPublish, mergePlayout, DAY, HOUR, MIN } from '../src/index';
import type { Channel, Checkpoint, Ruleset } from '../src/index';

const library = buildStubLibrary();
const base: Ruleset = { library, pools: defaultPools(), clocks: defaultClocks() };
const [retro] = defaultChannels() as [Channel, Channel];
const now = retro.anchorMs + 2 * DAY + 5 * HOUR + 7 * MIN; // Thu 11:07, two days after the anchor

describe('publish planning', () => {
  it('first publish: files for today through the horizon, boundary just after now', () => {
    const [plan] = planPublish([retro], base, { now, horizonDays: 2, checkpoints: {} });
    expect(plan!.files.map((f) => f.name).length).toBe(3);
    expect(plan!.boundary).toBeGreaterThan(now);
    expect(plan!.boundary - now).toBeLessThanOrEqual(30 * MIN);
    const today = plan!.files[0]!;
    expect(today.playout.items[0]!.start <= new Date(now).toISOString().slice(0, 10) + 'T99').toBe(true);
    expect(plan!.xmltv).toContain('<programme');
    expect(plan!.checkpoint.at).toBe(plan!.boundary);
  });

  it('republishing with unchanged rules reproduces the same items', () => {
    const [first] = planPublish([retro], base, { now, horizonDays: 2, checkpoints: {} });
    const later = now + 3 * HOUR;
    const [second] = planPublish([retro], base, { now: later, horizonDays: 2, checkpoints: { [retro.id]: first!.checkpoint } });
    const ids = (p: typeof first) => p!.files.flatMap((f) => f.playout.items.map((i) => `${i.id}@${i.start}`));
    const a = ids(first).filter((s) => Date.parse(s.split('@')[1]!) >= second!.boundary);
    const b = ids(second).filter((s) => Date.parse(s.split('@')[1]!) >= second!.boundary);
    expect(b.slice(0, 50)).toEqual(a.slice(0, 50));
  });

  it('a rule change applies from the boundary, and the past is replayed with the old rules', () => {
    const [first] = planPublish([retro], base, { now, horizonDays: 1, checkpoints: {} });
    const later = now + 2 * HOUR;
    const changed: Ruleset = { ...base, clocks: base.clocks.map((c) => c.id === 'clock-sitcom-30' ? { ...c, breaks: { ...c.breaks, poolId: 'pool-ads-all' } } : c) };
    const [second] = planPublish([retro], changed, { now: later, horizonDays: 1, checkpoints: { [retro.id]: first!.checkpoint } });
    const before = second!.blocks.filter((b) => b.end <= second!.boundary);
    const after = second!.blocks.filter((b) => b.start >= second!.boundary);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    // Old rules (90s only) before the boundary, new rules (all eras) after.
    const firstIds = new Set(first!.blocks.map((b) => b.programs.map((p) => p.id).join(',')));
    for (const b of before) expect(firstIds.has(b.programs.map((p) => p.id).join(','))).toBe(true);
    expect(after.some((b) => b.entries.some((e) => e.role === 'commercial' && e.item.path.includes('/80s/')))).toBe(true);
    expect(before.every((b) => b.entries.every((e) => e.role !== 'commercial' || e.item.path.includes('/90s/')))).toBe(true);
  });

  it('merge keeps already-written items before the boundary', () => {
    const [plan] = planPublish([retro], base, { now, horizonDays: 0, checkpoints: {} });
    const today = plan!.files[0]!.playout;
    const boundary = Date.parse(today.items[10]!.start);
    const fresh = { ...today, items: today.items.map((i) => ({ ...i, id: 'new-' + i.id })) };
    const merged = mergePlayout(today, fresh, boundary);
    expect(merged.items.slice(0, 10).map((i) => i.id)).toEqual(today.items.slice(0, 10).map((i) => i.id));
    expect(merged.items[10]!.id.startsWith('new-')).toBe(true);
    expect(merged.items.length).toBe(today.items.length);
  });

  it('mirror channels are planned from their source, shifted', () => {
    const west: Channel = { ...retro, id: 'ch-west', number: '9', tvgId: 'mimic.west', mirrorOf: retro.id, shiftMinutes: 180 };
    const plans = planPublish([retro, west], base, { now, horizonDays: 1, checkpoints: {} });
    const e = plans.find((p) => p.channel.id === retro.id)!, w = plans.find((p) => p.channel.id === 'ch-west')!;
    expect(w.boundary).toBe(e.boundary + 3 * HOUR);
    expect(w.blocks[0]!.start).toBe(e.blocks[0]!.start + 3 * HOUR);
  });
});

import { useDeferredValue, useMemo } from 'react';
import { simulateAll, planPublish, mergeTimeline, expandBlocks, DAY, MIN, type Channel, type Ruleset, type Simulation } from '@mimictv/core';
import { useStore, dateStart , useLibrary } from './store';
import { useNow } from './useNow';

export function useRuleset(): Ruleset {
  const library = useLibrary();
  const pools = useStore((s) => s.pools);
  const clocks = useStore((s) => s.clocks);
  return useMemo(() => ({ library, pools, clocks }), [library, pools, clocks]);
}

/** Only these channel fields affect the schedule; renaming a channel must not re-simulate it. */
function scheduleKey(c: Channel): string {
  return JSON.stringify([c.id, c.dayparts, c.anchorMs, c.seed, c.mirrorOf, c.shiftMinutes, c.cursorSeeds]);
}

/**
 * Simulate every channel together (cross-channel no-repeat and mirrors need each other)
 * through the preview day plus one. Inputs are deferred so typing stays responsive.
 *
 * Once the service has published, the preview is the publish plan: blocks already written
 * stay as they are up to the next block boundary after now, and the current rules take over
 * from there. That is exactly what the next publish will write, so what the guide shows is
 * what Next plays, and an edit visibly re-flows from the next break rather than from the anchor.
 */
export function useSims(): Map<string, Simulation | undefined> {
  const ruleset = useDeferredValue(useRuleset());
  const previewDate = useDeferredValue(useStore((s) => s.previewDate));
  const published = useStore((s) => s.published);
  // Whole minutes: the boundary only moves when now crosses a block end, so finer ticks would just re-plan for nothing.
  const nowMin = Math.floor(useNow(MIN) / MIN) * MIN;
  const channels = useStore((s) => s.channels);
  const key = channels.map(scheduleKey).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- key stands in for channels
  const stable = useMemo(() => channels, [key]);
  return useMemo(() => {
    const out = new Map<string, Simulation | undefined>();
    const runnable = stable.filter((c) => c.dayparts.length > 0 && c.dayparts.every((d) => ruleset.clocks.some((k) => k.id === d.clockId)) || (c.mirrorOf && stable.some((s) => s.id === c.mirrorOf)));
    try {
      const until = Math.max(dateStart(previewDate) + 2 * DAY, ...runnable.map((c) => c.anchorMs + DAY));
      if (published) {
        const plans = planPublish(runnable, ruleset, { now: nowMin, horizonDays: Math.max(1, Math.ceil((until - nowMin) / DAY)), checkpoints: published.checkpoints });
        for (const p of plans) out.set(p.channel.id, { channelId: p.channel.id, blocks: mergeTimeline(expandBlocks(published.timelines[p.channel.id], ruleset.library), p.blocks, p.boundary), cursors: p.checkpoint.cursors });
      } else {
        const sims = simulateAll(runnable, ruleset, until);
        for (const c of stable) out.set(c.id, sims.get(c.id));
      }
    } catch {
      for (const c of stable) out.set(c.id, undefined);
    }
    return out;
  }, [stable, ruleset, previewDate, published, nowMin]);
}

export function useSim(channel: Channel | undefined): Simulation | undefined {
  const sims = useSims();
  return channel ? sims.get(channel.id) : undefined;
}

export function useSelectedChannel(): Channel | undefined {
  const channels = useStore((s) => s.channels);
  const id = useStore((s) => s.selectedChannelId);
  return channels.find((c) => c.id === id) ?? channels[0];
}

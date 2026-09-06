import { useDeferredValue, useMemo } from 'react';
import { simulateAll, DAY, type Channel, type Ruleset, type Simulation } from '@mimictv/core';
import { useStore, dateStart } from './store';

export function useRuleset(): Ruleset {
  const library = useStore((s) => s.library);
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
 */
export function useSims(): Map<string, Simulation | undefined> {
  const ruleset = useDeferredValue(useRuleset());
  const previewDate = useDeferredValue(useStore((s) => s.previewDate));
  const channels = useStore((s) => s.channels);
  const key = channels.map(scheduleKey).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- key stands in for channels
  const stable = useMemo(() => channels, [key]);
  return useMemo(() => {
    const out = new Map<string, Simulation | undefined>();
    const runnable = stable.filter((c) => c.dayparts.length > 0 && c.dayparts.every((d) => ruleset.clocks.some((k) => k.id === d.clockId)) || (c.mirrorOf && stable.some((s) => s.id === c.mirrorOf)));
    try {
      const until = Math.max(dateStart(previewDate) + 2 * DAY, ...runnable.map((c) => c.anchorMs + DAY));
      const sims = simulateAll(runnable, ruleset, until);
      for (const c of stable) out.set(c.id, sims.get(c.id));
    } catch {
      for (const c of stable) out.set(c.id, undefined);
    }
    return out;
  }, [stable, ruleset, previewDate]);
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

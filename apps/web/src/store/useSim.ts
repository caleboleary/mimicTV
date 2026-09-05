import { useDeferredValue, useMemo } from 'react';
import { simulate, DAY, type Channel, type Ruleset, type Simulation } from '@mimictv/core';
import { useStore, dateStart } from './store';

export function useRuleset(): Ruleset {
  const library = useStore((s) => s.library);
  const pools = useStore((s) => s.pools);
  const clocks = useStore((s) => s.clocks);
  return useMemo(() => ({ library, pools, clocks }), [library, pools, clocks]);
}

function simFor(channel: Channel, ruleset: Ruleset, previewDate: string): Simulation | undefined {
  if (channel.dayparts.length === 0 || channel.dayparts.some((d) => !ruleset.clocks.some((c) => c.id === d.clockId))) return undefined;
  try {
    const until = dateStart(previewDate) + 2 * DAY;
    return simulate(channel, ruleset, Math.max(until, channel.anchorMs + DAY));
  } catch {
    return undefined;
  }
}

/** Only these channel fields affect the schedule; renaming a channel must not re-simulate it. */
function scheduleKey(c: Channel): string {
  return JSON.stringify([c.id, c.dayparts, c.anchorMs, c.seed]);
}

/**
 * Simulate a channel through the preview day plus one day for "upcoming" views.
 * Inputs are deferred so typing stays responsive; the preview catches up a beat later.
 */
export function useSim(channel: Channel | undefined): Simulation | undefined {
  const ruleset = useDeferredValue(useRuleset());
  const previewDate = useDeferredValue(useStore((s) => s.previewDate));
  const key = channel ? scheduleKey(channel) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- key stands in for channel
  const stable = useMemo(() => channel, [key]);
  return useMemo(() => (stable ? simFor(stable, ruleset, previewDate) : undefined), [stable, ruleset, previewDate]);
}

export function useSims(channels: Channel[]): Map<string, Simulation | undefined> {
  const ruleset = useDeferredValue(useRuleset());
  const previewDate = useDeferredValue(useStore((s) => s.previewDate));
  const key = channels.map(scheduleKey).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- key stands in for channels
  const stable = useMemo(() => channels, [key]);
  return useMemo(() => new Map(stable.map((c) => [c.id, simFor(c, ruleset, previewDate)])), [stable, ruleset, previewDate]);
}

export function useSelectedChannel(): Channel | undefined {
  const channels = useStore((s) => s.channels);
  const id = useStore((s) => s.selectedChannelId);
  return channels.find((c) => c.id === id) ?? channels[0];
}

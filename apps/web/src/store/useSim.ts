import { useMemo } from 'react';
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

/** Simulate a channel through the preview day plus one day for "upcoming" views. */
export function useSim(channel: Channel | undefined): Simulation | undefined {
  const ruleset = useRuleset();
  const previewDate = useStore((s) => s.previewDate);
  return useMemo(() => (channel ? simFor(channel, ruleset, previewDate) : undefined), [channel, ruleset, previewDate]);
}

export function useSims(channels: Channel[]): Map<string, Simulation | undefined> {
  const ruleset = useRuleset();
  const previewDate = useStore((s) => s.previewDate);
  return useMemo(() => new Map(channels.map((c) => [c.id, simFor(c, ruleset, previewDate)])), [channels, ruleset, previewDate]);
}

export function useSelectedChannel(): Channel | undefined {
  const channels = useStore((s) => s.channels);
  const id = useStore((s) => s.selectedChannelId);
  return channels.find((c) => c.id === id) ?? channels[0];
}

import { useMemo } from 'react';
import { simulate, DAY, type Channel, type Ruleset, type Simulation } from '@mimictv/core';
import { useStore, dateStart } from './store';

export function useRuleset(): Ruleset {
  const library = useStore((s) => s.library);
  const pools = useStore((s) => s.pools);
  const clocks = useStore((s) => s.clocks);
  return useMemo(() => ({ library, pools, clocks }), [library, pools, clocks]);
}

/** Simulate a channel through the end of the preview day plus one extra day for "upcoming" views. */
export function useSim(channel: Channel | undefined): Simulation | undefined {
  const ruleset = useRuleset();
  const previewDate = useStore((s) => s.previewDate);
  return useMemo(() => {
    if (!channel) return undefined;
    if (channel.dayparts.length === 0 || channel.dayparts.some((d) => !ruleset.clocks.some((c) => c.id === d.clockId))) return undefined;
    const until = dateStart(previewDate) + 2 * DAY;
    if (until <= channel.anchorMs) return simulate(channel, ruleset, channel.anchorMs + DAY);
    return simulate(channel, ruleset, until);
  }, [channel, ruleset, previewDate]);
}

export function useSelectedChannel(): Channel | undefined {
  const channels = useStore((s) => s.channels);
  const id = useStore((s) => s.selectedChannelId);
  return channels.find((c) => c.id === id) ?? channels[0];
}

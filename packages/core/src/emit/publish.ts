/**
 * Publishing: turn channels + rules + the last checkpoint into the exact files Next needs.
 * Pure: no file system here. The server writes what this returns.
 *
 * The idea: a checkpoint remembers cursor state at a moment T and the rules in force then.
 * Replaying those rules from T is deterministic, so we can reproduce what was already
 * written up to the first block boundary after "now", then continue with the current rules
 * from that boundary. Untouched channels reproduce their old timeline exactly.
 */
import type { Channel, Clock, CursorState, Pool, Ruleset, ScheduledBlock, Simulation } from '../types';
import { DAY, localMidnight } from '../time';
import { simulate, simulateAll, shiftSimulation } from '../engine/schedule';

const inWindow = (blocks: ScheduledBlock[], start: number, end: number) => blocks.filter((b) => b.end > start && b.start < end);
import { toPlayout, playoutFileName, type PlayoutFile, type PlayoutItem } from './playout';
import { toXmltv, programmesFor } from './xmltv';

export interface Checkpoint {
  /** Moment the cursors describe: the boundary where the rules below took effect. */
  at: number;
  cursors: CursorState;
  /** Rules in force from `at`, so the timeline after it can be replayed exactly. */
  pools: Pool[];
  clocks: Clock[];
  channel: Channel;
}

export interface PublishOptions {
  now: number;
  /** Whole days ahead of today to keep written. */
  horizonDays: number;
  checkpoints: Record<string, Checkpoint | undefined>;
  pathMap?: (p: string) => string;
  /** Base URL of mimicTV's resolver for live breaks; omit to write pre-picked ads. */
  dynamicBaseUrl?: string;
}

export interface PlannedFile { name: string; start: number; end: number; playout: PlayoutFile }

export interface ChannelPlan {
  channel: Channel;
  /** New rules take effect here; items before it must be kept as already written. */
  boundary: number;
  blocks: ScheduledBlock[];
  files: PlannedFile[];
  xmltv: string;
  checkpoint: Checkpoint;
}

function nextMidnight(ms: number): number {
  const d = new Date(localMidnight(ms));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/** Replay a channel's own recorded rules from its checkpoint up to the first block end after `now`. */
function replayToBoundary(channel: Channel, ruleset: Ruleset, cp: Checkpoint | undefined, now: number): Simulation {
  if (!cp) return simulate(channel, ruleset, now);
  const prevRules: Ruleset = { library: ruleset.library, pools: cp.pools, clocks: cp.clocks };
  return simulate(cp.channel, prevRules, now, { channelId: channel.id, blocks: [], cursors: cp.cursors });
}

export function planPublish(channels: Channel[], ruleset: Ruleset, opts: PublishOptions): ChannelPlan[] {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const sources = channels.filter((c) => !c.mirrorOf || !byId.has(c.mirrorOf));
  const until = nextMidnight(opts.now) + opts.horizonDays * DAY;

  // 1. Each source channel replays its old rules to its boundary.
  const pre = new Map(sources.map((c) => [c.id, replayToBoundary(c, ruleset, opts.checkpoints[c.id], opts.now)]));
  // 2. Then all of them continue together under the current rules.
  const priors = new Map(sources.map((c) => [c.id, { channelId: c.id, blocks: [], cursors: pre.get(c.id)!.cursors } as Simulation]));
  const post = simulateAll(sources, ruleset, until, priors);

  const plans: ChannelPlan[] = [];
  const build = (channel: Channel, blocks: ScheduledBlock[], boundary: number, cursorsAtBoundary: CursorState): ChannelPlan => {
    const files: PlannedFile[] = [];
    for (let day = localMidnight(opts.now); day < until; day = nextMidnight(day)) {
      const end = nextMidnight(day);
      const dayBlocks = inWindow(blocks, day, end);
      if (dayBlocks.length === 0) continue;
      const playout = toPlayout(dayBlocks, {
        clocks: ruleset.clocks, pathMap: opts.pathMap, generatedAt: opts.now, window: { start: day, end },
        dynamic: opts.dynamicBaseUrl ? { baseUrl: opts.dynamicBaseUrl, channelId: channel.id } : undefined,
      });
      files.push({ name: playoutFileName(day, end), start: day, end, playout });
    }
    const xmltv = toXmltv(channel, programmesFor(inWindow(blocks, localMidnight(opts.now), until), ruleset.library));
    const checkpoint: Checkpoint = { at: boundary, cursors: cursorsAtBoundary, pools: ruleset.pools, clocks: ruleset.clocks, channel };
    return { channel, boundary, blocks, files, xmltv, checkpoint };
  };

  for (const c of sources) {
    const a = pre.get(c.id)!, b = post.get(c.id)!;
    plans.push(build(c, [...a.blocks, ...b.blocks], a.cursors.asOf, a.cursors));
  }
  for (const c of channels) {
    if (!c.mirrorOf || !byId.has(c.mirrorOf)) continue;
    const srcPlan = plans.find((p) => p.channel.id === c.mirrorOf);
    if (!srcPlan) continue;
    const shifted = shiftSimulation({ channelId: c.mirrorOf, blocks: srcPlan.blocks, cursors: srcPlan.checkpoint.cursors }, c);
    plans.push(build(c, shifted.blocks, srcPlan.boundary + (c.shiftMinutes ?? 0) * 60000, shifted.cursors));
  }
  return plans;
}

/** Keep what was already written before the boundary; take the fresh plan from the boundary on. */
export function mergePlayout(existing: PlayoutFile | undefined, fresh: PlayoutFile, boundaryMs: number): PlayoutFile {
  if (!existing) return fresh;
  const startOf = (i: PlayoutItem) => Date.parse(i.start);
  const kept = existing.items.filter((i) => startOf(i) < boundaryMs);
  const keptIds = new Set(kept.map((i) => i.id));
  const added = fresh.items.filter((i) => startOf(i) >= boundaryMs && !keptIds.has(i.id));
  return { ...fresh, items: [...kept, ...added] };
}

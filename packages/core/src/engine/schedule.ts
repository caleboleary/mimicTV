import type {
  Channel, Clock, CursorState, Daypart, MediaItem, Ruleset, ScheduledBlock, ScheduledBreak, Simulation, TimelineEntry,
} from '../types';
import { rngFor, type Rng } from '../rng';
import { MIN, SEC, ceilToMinutes, distanceToBoundary, fmtClock, localMidnight } from '../time';
import { BLACK, Selector } from './select';

const MIN_MID_BREAK_MS = 20 * SEC;
/** Runaway guard only; the time budget and the clock's maxItems are the real limits. */
const MAX_ADS_PER_BREAK = 500;
const MAX_PROGRAMS_PER_BLOCK = 16;
const MAX_BLOCKS_PER_RUN = 20000;

interface Ctx {
  channel: Channel;
  ruleset: Ruleset;
  rng: Rng;
  cursors: CursorState;
  selector: Selector;
  clocksById: Map<string, Clock>;
}

const isFixed = (d: Daypart) => d.endMinute != null && d.endMinute > d.startMinute;

/** The band in force at `ms`: a fixed show if one covers it, else the latest base band. */
export function daypartForTime(channel: Channel, ms: number): Daypart | undefined {
  const minutes = (ms - localMidnight(ms)) / MIN;
  const fixed = channel.dayparts.find((d) => isFixed(d) && d.startMinute <= minutes && minutes < d.endMinute!);
  if (fixed) return fixed;
  const bases = channel.dayparts.filter((d) => !isFixed(d)).sort((a, b) => a.startMinute - b.startMinute);
  let chosen = bases[bases.length - 1];
  for (const p of bases) if (p.startMinute <= minutes) chosen = p;
  return chosen;
}

export function clockForTime(channel: Channel, clocks: Map<string, Clock>, ms: number): Clock {
  const chosen = daypartForTime(channel, ms);
  const clock = chosen ? clocks.get(chosen.clockId) : undefined;
  if (!clock) throw new Error(`Channel ${channel.id} has no usable clock at ${fmtClock(ms)}`);
  return clock;
}

/**
 * The next moment a block starting at `ms` must not run past: the end of the fixed show in
 * force, or the start of the next fixed show. Undefined when the channel has none.
 */
export function hardStopAfter(channel: Channel, ms: number): number | undefined {
  const fixed = channel.dayparts.filter(isFixed);
  if (fixed.length === 0) return undefined;
  const mid = localMidnight(ms);
  const minutes = (ms - mid) / MIN;
  const current = fixed.find((d) => d.startMinute <= minutes && minutes < d.endMinute!);
  if (current) return mid + current.endMinute! * MIN;
  const d = new Date(mid);
  const nextMid = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  let best: number | undefined;
  for (const f of fixed) {
    const at = f.startMinute > minutes ? mid + f.startMinute * MIN : nextMid + f.startMinute * MIN;
    if (best == null || at < best) best = at;
  }
  return best;
}

interface Segment {
  program: MediaItem;
  programIndex: number;
  inMs: number;
  outMs: number;
  partIndex: number;
  partCount: number;
}

const DEFAULT_MIN_SEGMENT_MS = 3 * MIN;

/** Candidate cut points for a program: its own break points if allowed and present, else the clock's fallback. */
export function candidateCuts(program: MediaItem, breaks: Clock['breaks']): number[] {
  if (breaks.atChapters && program.breakPoints.length > 0) return program.breakPoints;
  const fb = breaks.fallback;
  if (!fb || fb.mode === 'none') return [];
  if (fb.mode === 'offsets') return fb.offsetsMs.filter((ms) => ms > 0 && ms < program.durationMs);
  if (fb.everyMs <= 0) return [];
  const out: number[] = [];
  for (let t = fb.everyMs; t < program.durationMs; t += fb.everyMs) out.push(t);
  return out;
}

function segmentsFor(program: MediaItem, programIndex: number, breaks: Clock['breaks'], minSegmentMs: number): Segment[] {
  const cuts: number[] = [];
  // Keep a cut only if both the segment before it and the remainder after it are long enough.
  // This drops "intro" chapters at 0:30 and credits chapters near the end.
  let last = 0;
  for (const b of [...candidateCuts(program, breaks)].sort((a, b) => a - b)) {
    if (b - last >= minSegmentMs && program.durationMs - b >= minSegmentMs) { cuts.push(b); last = b; }
  }
  const bounds = [0, ...cuts, program.durationMs];
  const out: Segment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    out.push({
      program,
      programIndex,
      inMs: bounds[i]!,
      outMs: bounds[i + 1]!,
      partIndex: i,
      partCount: bounds.length - 1,
    });
  }
  return out;
}

function fillBreak(
  ctx: Ctx,
  clock: Clock,
  blockId: string,
  brk: { index: number; kind: 'mid' | 'post' },
  start: number,
  targetMs: number,
  nextId: () => string,
): ScheduledBreak {
  const entries: TimelineEntry[] = [];
  const end = start + targetMs;
  const nearBoundary =
    clock.networkId.enabled && distanceToBoundary(end, clock.networkId.nearMinutes) <= clock.networkId.windowMs;

  let idItem: MediaItem | undefined;
  if (nearBoundary && targetMs > 0) {
    idItem = ctx.selector.pickInterstitial(clock.networkId.poolId, start, targetMs);
  }
  const idMs = idItem ? idItem.durationMs : 0;
  const budget = targetMs - idMs;

  // Commercials first.
  const ads: MediaItem[] = [];
  const used = new Set<string>();
  let usedMs = 0;
  if (clock.breaks.poolId) {
    for (let guard = 0; guard < MAX_ADS_PER_BREAK; guard++) {
      if (clock.breaks.maxItems > 0 && ads.length >= clock.breaks.maxItems) break;
      const remaining = budget - usedMs;
      if (remaining < 10 * SEC) break;
      const ad = ctx.selector.pickInterstitial(clock.breaks.poolId, start + usedMs, remaining, used);
      if (!ad || ad.trimmable) break;
      ads.push(ad);
      used.add(ad.id);
      usedMs += ad.durationMs;
    }
  }

  // Then pad the remainder with filler. Trimmable filler guarantees we land exactly on target.
  const fillers: { item: MediaItem; ms: number }[] = [];
  let gap = budget - usedMs;
  for (let guard = 0; gap > 0 && guard < 20; guard++) {
    let f = ctx.selector.pickInterstitial(clock.pad.poolId, start + usedMs, gap, used);
    if (!f) f = BLACK;
    let take: number;
    if (f.still || f.durationMs === 0) take = gap;
    else if (f.trimmable) take = Math.min(gap, f.durationMs);
    else take = f.durationMs;
    if (take <= 0) break;
    fillers.push({ item: f, ms: take });
    if (!f.still) used.add(f.id);
    gap -= take;
  }
  if (gap > 0) fillers.push({ item: BLACK, ms: gap });

  // Lay them out: ads, filler, ID last.
  let t = start;
  for (const ad of ads) {
    entries.push({
      id: nextId(), start: t, end: t + ad.durationMs, item: ad, role: 'commercial',
      inMs: 0, outMs: ad.durationMs, blockId, breakIndex: brk.index,
      reason: `Commercial from pool "${ctx.selector.pool(clock.breaks.poolId)?.name ?? clock.breaks.poolId}"`,
    });
    ctx.selector.markPlayed(ad, t);
    t += ad.durationMs;
  }
  for (const f of fillers) {
    entries.push({
      id: nextId(), start: t, end: t + f.ms, item: f.item, role: 'filler',
      inMs: 0, outMs: f.ms, blockId, breakIndex: brk.index,
      reason: f.item.trimmable
        ? `Pad ${Math.round(f.ms / 100) / 10}s to reach the ${clock.pad.toMinutes}-minute boundary`
        : 'Filler clip',
    });
    ctx.selector.markPlayed(f.item, t);
    t += f.ms;
  }
  if (idItem) {
    entries.push({
      id: nextId(), start: t, end: t + idMs, item: idItem, role: 'network-id',
      inMs: 0, outMs: idMs, blockId, breakIndex: brk.index,
      reason: `Break ends within ${clock.networkId.windowMs / MIN} min of :${clock.networkId.nearMinutes.map((m) => String(m).padStart(2, '0')).join('/:')}, so a network ID goes last`,
    });
    ctx.selector.markPlayed(idItem, t);
    t += idMs;
  }

  return { index: brk.index, kind: brk.kind, start, end, targetMs, nearBoundary, entries };
}

export function buildBlock(ctx: Ctx, clock: Clock, start: number, blockIndex: number, hardStop?: number): ScheduledBlock {
  const blockId = `${ctx.channel.id}-b${blockIndex}`;
  let n = 0;
  const nextId = () => `${blockId}-${++n}`;
  // Room left before a fixed show must start (or the current one must end).
  const room = hardStop != null ? hardStop - start : undefined;

  // 1. Pull programs until the content target is met.
  const programs: { item: MediaItem; reason: string }[] = [];
  let contentMs = 0;
  const { targetMs, toleranceMs, allowMultiple } = clock.program;
  while (programs.length < MAX_PROGRAMS_PER_BLOCK) {
    // The first program is unconstrained (unless a fixed show is near); extra programs must fit the remaining budget.
    let maxMs = programs.length === 0 ? undefined : targetMs + toleranceMs - contentMs;
    if (room != null) maxMs = Math.min(maxMs ?? Infinity, room - contentMs);
    const pick = ctx.selector.pickProgram(clock.program.poolId, start, maxMs);
    if (!pick) break;
    programs.push(pick);
    contentMs += pick.item.durationMs;
    if (!allowMultiple || contentMs >= targetMs - toleranceMs) break;
  }
  if (programs.length === 0) {
    // Nothing fits (empty pool, or a fixed show is too close): pad until the next stop so the channel keeps moving.
    const end = room != null && room > 0 ? hardStop! : start + Math.max(clock.pad.toMinutes, 30) * MIN;
    const brk = fillBreak(ctx, clock, blockId, { index: 0, kind: 'post' }, start, end - start, nextId);
    return { id: blockId, clockId: clock.id, start, end, programs: [], breaks: [brk], entries: brk.entries, contentMs: 0, breakBudgetMs: end - start };
  }

  // 2. Cut programs into segments at their break points, and decide which segments a break follows.
  //    Cuts inside a program always get one. Between stacked programs, only every Nth boundary does.
  const minSeg = clock.breaks.minSegmentMs ?? DEFAULT_MIN_SEGMENT_MS;
  const segments = programs.flatMap((p, i) => segmentsFor(p.item, i, clock.breaks, minSeg));
  const every = clock.breaks.betweenPrograms ?? 1;
  let sinceBreak = 0;
  const breakAfter = segments.map((seg, i) => {
    if (i === segments.length - 1) return true; // post-roll
    if (seg.partIndex < seg.partCount - 1) return true; // cut inside a program
    sinceBreak++;
    if (every > 0 && sinceBreak >= every) { sinceBreak = 0; return true; }
    return false;
  });
  const breakCount = breakAfter.filter(Boolean).length;
  const midCount = breakCount - 1;

  // 3. Decide the block end: next boundary, bumped if breaks can't fit. No padding = content only.
  let end: number;
  if (clock.pad.toMinutes > 0) {
    end = ceilToMinutes(start + contentMs + midCount * MIN_MID_BREAK_MS, clock.pad.toMinutes);
    if (end <= start + contentMs) end += clock.pad.toMinutes * MIN;
  } else {
    end = start + contentMs;
  }
  // Never run into a fixed show. Programs were picked to fit, so only the padding gives way.
  if (hardStop != null && end > hardStop && hardStop >= start + contentMs) end = hardStop;
  const budget = end - start - contentMs;

  // 4. Distribute the budget across breaks.
  const targets: number[] = [];
  if (clock.breaks.equalize || midCount === 0) {
    const each = Math.floor(budget / breakCount / 100) * 100;
    for (let i = 0; i < breakCount; i++) targets.push(each);
    targets[breakCount - 1]! += budget - each * breakCount;
  } else {
    let mid = clock.breaks.midTargetMs;
    if (mid * midCount > budget) mid = Math.floor(budget / breakCount / 100) * 100;
    for (let i = 0; i < midCount; i++) targets.push(mid);
    targets.push(budget - mid * midCount);
  }

  // 5. Walk segments and breaks, laying entries down contiguously.
  const entries: TimelineEntry[] = [];
  const breaks: ScheduledBreak[] = [];
  let t = start;
  let breakIdx = 0;
  segments.forEach((seg, i) => {
    const pick = programs[seg.programIndex]!;
    const ms = seg.outMs - seg.inMs;
    entries.push({
      id: nextId(), start: t, end: t + ms, item: seg.program, role: 'program',
      inMs: seg.inMs, outMs: seg.outMs, blockId,
      partIndex: seg.partIndex, partCount: seg.partCount,
      reason: seg.partIndex === 0 ? pick.reason : `Part ${seg.partIndex + 1} of ${seg.partCount} (resumes after chapter break)`,
    });
    if (seg.partIndex === 0) ctx.selector.markPlayed(seg.program, t);
    t += ms;
    if (!breakAfter[i]) return;
    const isLast = i === segments.length - 1;
    const brk = fillBreak(
      ctx, clock, blockId,
      { index: breakIdx, kind: isLast ? 'post' : 'mid' },
      t, targets[breakIdx]!, nextId,
    );
    breakIdx++;
    if (brk.entries.length > 0 || brk.targetMs > 0) breaks.push(brk);
    entries.push(...brk.entries);
    t = brk.end;
  });

  return {
    id: blockId, clockId: clock.id, start, end: t,
    programs: programs.map((p) => p.item), breaks, entries, contentMs, breakBudgetMs: budget,
  };
}

export function freshCursors(channel: Channel): CursorState {
  return { showNext: {}, poolNext: {}, lastPlayed: {}, asOf: channel.anchorMs };
}

/**
 * Advance a channel's timeline until it covers `untilMs`. Pass a prior Simulation
 * (built from the same rules) to resume instead of starting from the anchor.
 */
export function simulate(channel: Channel, ruleset: Ruleset, untilMs: number, prior?: Simulation): Simulation {
  const cursors: CursorState = prior
    ? structuredClone(prior.cursors)
    : freshCursors(channel);
  const rng = rngFor(channel.seed, cursors.rngState);
  const clocksById = new Map(ruleset.clocks.map((c) => [c.id, c]));
  const selector = new Selector(ruleset.library, ruleset.pools, rng, cursors);
  const ctx: Ctx = { channel, ruleset, rng, cursors, selector, clocksById };
  const blocks = prior ? [...prior.blocks] : [];

  let guard = 0;
  while (cursors.asOf < untilMs && guard++ < MAX_BLOCKS_PER_RUN) {
    const clock = clockForTime(channel, clocksById, cursors.asOf);
    const block = buildBlock(ctx, clock, cursors.asOf, blocks.length, hardStopAfter(channel, cursors.asOf));
    blocks.push(block);
    cursors.asOf = block.end;
  }
  cursors.rngState = rng.state();
  return { channelId: channel.id, blocks, cursors };
}

export function blocksInWindow(sim: Simulation, start: number, end: number): ScheduledBlock[] {
  return sim.blocks.filter((b) => b.end > start && b.start < end);
}

export function entriesInWindow(sim: Simulation, start: number, end: number): TimelineEntry[] {
  return blocksInWindow(sim, start, end).flatMap((b) => b.entries).filter((e) => e.end > start && e.start < end);
}

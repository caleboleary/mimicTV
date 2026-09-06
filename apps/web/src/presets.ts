import { MIN, SEC, type Clock } from '@mimictv/core';

/**
 * Format presets: the plain-language way to set a clock. Each one is a partial shape;
 * applying it keeps the clock's pools and name, and "matches" tells the UI which chip to light.
 */
type Shape = {
  program: Pick<Clock['program'], 'targetMs' | 'toleranceMs' | 'allowMultiple'>;
  breaks: Pick<Clock['breaks'], 'atChapters' | 'equalize' | 'midTargetMs' | 'maxItems'> & { fallback: NonNullable<Clock['breaks']['fallback']>; betweenPrograms: number };
  pad: Pick<Clock['pad'], 'toMinutes'>;
  networkId: Pick<Clock['networkId'], 'enabled'>;
  offAir: boolean;
};

export interface FormatPreset { id: string; label: string; hint: string; shape: Shape }

const ids = { enabled: true };
export const PRESETS: FormatPreset[] = [
  { id: 'sitcom', label: 'Half-hour show', hint: '22 min of content padded to :30. Breaks at chapters, else every 8 min. IDs near :00/:30.',
    shape: { program: { targetMs: 22 * MIN, toleranceMs: 4 * MIN, allowMultiple: true }, breaks: { atChapters: true, fallback: { mode: 'interval', everyMs: 8 * MIN }, betweenPrograms: 1, equalize: true, midTargetMs: 2 * MIN, maxItems: 0 }, pad: { toMinutes: 30 }, networkId: ids, offAir: false } },
  { id: 'shorts', label: 'Cartoon shorts', hint: 'Two 11-min shorts fill a half hour, a short break between them, up to 4 ads per break.',
    shape: { program: { targetMs: 22 * MIN, toleranceMs: 3 * MIN, allowMultiple: true }, breaks: { atChapters: true, fallback: { mode: 'none' }, betweenPrograms: 1, equalize: true, midTargetMs: 90 * SEC, maxItems: 4 }, pad: { toMinutes: 30 }, networkId: ids, offAir: false } },
  { id: 'drama', label: 'Hour drama', hint: '44 min of content padded to the hour. Breaks at chapters, else every 11 min.',
    shape: { program: { targetMs: 44 * MIN, toleranceMs: 6 * MIN, allowMultiple: false }, breaks: { atChapters: true, fallback: { mode: 'interval', everyMs: 11 * MIN }, betweenPrograms: 1, equalize: true, midTargetMs: 150 * SEC, maxItems: 0 }, pad: { toMinutes: 30 }, networkId: ids, offAir: false } },
  { id: 'movies', label: 'Movies', hint: 'One film per slot, padded to the next :30. A break every 25 min unless the file has chapters.',
    shape: { program: { targetMs: 100 * MIN, toleranceMs: 30 * MIN, allowMultiple: false }, breaks: { atChapters: true, fallback: { mode: 'interval', everyMs: 25 * MIN }, betweenPrograms: 1, equalize: true, midTargetMs: 3 * MIN, maxItems: 0 }, pad: { toMinutes: 30 }, networkId: ids, offAir: false } },
  { id: 'binge', label: 'Back to back', hint: 'No ads, no padding, no IDs. Each episode starts when the last one ends, like a streaming queue.',
    shape: { program: { targetMs: 22 * MIN, toleranceMs: 4 * MIN, allowMultiple: false }, breaks: { atChapters: false, fallback: { mode: 'none' }, betweenPrograms: 1, equalize: true, midTargetMs: 0, maxItems: 0 }, pad: { toMinutes: 0 }, networkId: { enabled: false }, offAir: false } },
  { id: 'offair', label: 'Off air', hint: 'Nothing but the filler pool: a static card or test pattern. No shows, no ads, no IDs. For overnight bands.',
    shape: { program: { targetMs: 30 * MIN, toleranceMs: 0, allowMultiple: false }, breaks: { atChapters: false, fallback: { mode: 'none' }, betweenPrograms: 1, equalize: true, midTargetMs: 0, maxItems: 0 }, pad: { toMinutes: 30 }, networkId: { enabled: false }, offAir: true } },
  { id: 'videos', label: 'Music videos', hint: 'Clips stack to fill a half hour with a short break after every 4.',
    shape: { program: { targetMs: 27 * MIN, toleranceMs: 3 * MIN, allowMultiple: true }, breaks: { atChapters: false, fallback: { mode: 'none' }, betweenPrograms: 4, equalize: true, midTargetMs: 60 * SEC, maxItems: 3 }, pad: { toMinutes: 30 }, networkId: ids, offAir: false } },
];

export function applyPreset(c: Clock, p: FormatPreset): Clock {
  return {
    ...c,
    program: { ...c.program, ...p.shape.program },
    breaks: { ...c.breaks, ...p.shape.breaks },
    pad: { ...c.pad, ...p.shape.pad },
    networkId: { ...c.networkId, ...p.shape.networkId },
    offAir: p.shape.offAir || undefined,
  };
}

function shapeOf(c: Clock): Shape {
  return {
    program: { targetMs: c.program.targetMs, toleranceMs: c.program.toleranceMs, allowMultiple: c.program.allowMultiple },
    breaks: { atChapters: c.breaks.atChapters, fallback: c.breaks.fallback ?? { mode: 'none' }, betweenPrograms: c.breaks.betweenPrograms ?? 1, equalize: c.breaks.equalize, midTargetMs: c.breaks.midTargetMs, maxItems: c.breaks.maxItems },
    pad: { toMinutes: c.pad.toMinutes },
    networkId: { enabled: c.networkId.enabled },
    offAir: !!c.offAir,
  };
}

/** The preset a clock currently equals, if any. */
export function matchingPreset(c: Clock): FormatPreset | undefined {
  const s = JSON.stringify(shapeOf(c));
  return PRESETS.find((p) => JSON.stringify(p.shape) === s);
}

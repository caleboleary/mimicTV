/**
 * Break points found by measuring the video, decided per show, stored under data/breaks/<show>.json.
 * See docs/breaks.md. Measured rows keep seconds and dB as ffmpeg reports them; breaks are ms offsets
 * like MediaItem.breakPoints.
 */

/** One black gap: where, how long, how loud during it and just before/after. Same rows chapterize.py cached. */
export interface BlackRow {
  /** Start, seconds. */
  t: number;
  dur: number;
  /** t / duration. */
  frac: number;
  /** Mean volume during the gap, dB. */
  db: number;
  /** Mean volume 2 s before and 0.5 s after the gap, dB. */
  pre: number;
  post: number;
}

/** Scene cuts and silences measured in a window, for files whose break has no black frame. */
export interface SceneWindow {
  /** Window centre, seconds. */
  center: number;
  cuts: { t: number; score: number }[];
  silences: [number, number][];
}

export interface DetectSettings {
  /** Shortest black to record, seconds. */
  minBlack: number;
  /** Luminance threshold for "black"; raise for dark-blue fades. */
  pix: number;
  /** Ignore blacks this close to either end, seconds. */
  edge: number;
  /** Segment mode: seconds either side of a template centre to search. */
  tol: number;
  /** Segment mode: a cluster must appear in this fraction of episodes to become a template. */
  coverage: number;
  /** A black at or below this dB is quiet, which confirms a break in segment mode. */
  quiet: number;
  /** Blacks louder than this during the gap are never breaks. */
  loud: number;
  /** Story mode: candidates must fall in this fraction of the runtime. */
  band: [number, number];
  /** The real cut is often this many seconds before a very quiet title-card black. */
  pullMin: number;
  pullMax: number;
  /** Files under this many minutes are shorts and get no breaks. */
  short: number;
  /** Breaks per episode in story mode; null = from the runtime class. */
  breaksPerEpisode: number | null;
}

export const DEFAULT_DETECT: DetectSettings = {
  minBlack: 0.3, pix: 0.10, edge: 45, tol: 75, coverage: 0.5, quiet: -30, loud: -18, band: [0.2, 0.8],
  pullMin: 6, pullMax: 15, short: 15, breaksPerEpisode: null,
};

/** Three sensitivity presets for the UI, mapping to the two ffmpeg thresholds. */
export const SENSITIVITY = {
  normal: { minBlack: 0.3, pix: 0.10 },
  /** Short, not-quite-black fades (AMZN masters). */
  sensitive: { minBlack: 0.2, pix: 0.20 },
  /** Only long, truly black gaps. */
  strict: { minBlack: 0.5, pix: 0.05 },
} as const;

export interface MeasuredFile {
  /** ISO time of the measurement. */
  at: string;
  settings: { minBlack: number; pix: number; edge: number };
  blacks: BlackRow[];
  scenes?: SceneWindow[];
}

export type BreakSourceKind = 'detected' | 'scene' | 'manual' | 'embedded';
export interface BreakMark { at: number; source: BreakSourceKind; confidence?: 'strong' | 'weak' }

/**
 * detected/manual: use `breaks`. timed: no break points, the clock's fallback applies.
 * none: no breaks at all, even by the clock. Absent: never decided; the scan's chapters stand.
 */
export type BreakDecision = 'detected' | 'manual' | 'timed' | 'none';

export interface FileBreaks {
  key: { size?: number; durationMs: number };
  decision?: BreakDecision;
  breaks: BreakMark[];
  /** Candidate offsets (ms) the user turned down, so they are not proposed again. */
  rejected: number[];
  measured?: MeasuredFile;
}

export interface ShowBreaks {
  version: 1;
  folder: string;
  settings: Partial<DetectSettings>;
  /** Keyed by path relative to `folder`. */
  files: Record<string, FileBreaks>;
}

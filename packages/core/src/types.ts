// Domain model for mimicTV. Nothing in here knows about the Next playout JSON shape;
// that lives exclusively in emit/.

export type MediaKind = 'episode' | 'movie' | 'commercial' | 'network-id' | 'filler';

export interface Show {
  id: string;
  title: string;
  year: number;
  tags: string[];
}

export interface MediaInfo {
  container?: string;
  videoCodec?: string;
  width?: number;
  height?: number;
  frameRate?: string;
  audioCodec?: string;
  audioChannels?: number;
  hasSubtitles?: boolean;
  sizeBytes?: number;
}

export interface MediaItem {
  id: string;
  kind: MediaKind;
  title: string;
  path: string;
  durationMs: number;
  showId?: string;
  season?: number;
  episode?: number;
  tags: string[];
  /** Candidate break offsets (ms into the file), sorted, strictly inside the file. */
  breakPoints: number[];
  breakSource: 'chapters' | 'blackdetect' | 'manual' | 'none';
  /** Filler that can be cut to any length (a still image, a long ambient loop). */
  trimmable?: boolean;
  /** Source is a still image: video comes from the image, audio is synthesized silence. */
  still?: boolean;
  /** Stream facts from ffprobe, when the library came from a real scan. */
  media?: MediaInfo;
}

export interface Library {
  shows: Show[];
  items: MediaItem[];
}

export type SelectionMode =
  | 'shows-shuffled-episodes-in-order'
  | 'sequential'
  | 'random'
  | 'shuffle';

export interface PoolFilter {
  kinds?: MediaKind[];
  showIds?: string[];
  tags?: string[];
  /** Items carrying any of these tags are left out, e.g. ['unnumbered'] to skip extras and movies in show folders. */
  excludeTags?: string[];
}

export interface Pool {
  id: string;
  name: string;
  description?: string;
  filter: PoolFilter;
  selection: SelectionMode;
  /** For random selection: avoid repeating an item within this much channel time. */
  noRepeatMs?: number;
}

export interface Clock {
  id: string;
  name: string;
  program: {
    poolId: string;
    /** Target content length for the slot, e.g. 22 min. */
    targetMs: number;
    /** Accept content this far under target before pulling another program. */
    toleranceMs: number;
    /** Pull more than one program (two 11-min eps) to reach the target. */
    allowMultiple: boolean;
  };
  breaks: {
    /** Insert mid-roll breaks at each program's break points. */
    atChapters: boolean;
    poolId: string;
    /** Spread the pad budget evenly across all breaks (mid + post). */
    equalize: boolean;
    /** When not equalizing, mid-rolls get this target and the post-roll absorbs the rest. */
    midTargetMs: number;
    /** Max commercials per break; 0 = unlimited. */
    maxItems: number;
    /** Ignore break points that would leave a program segment shorter than this (default 3 min). */
    minSegmentMs?: number;
  };
  networkId: {
    enabled: boolean;
    poolId: string;
    /** Minutes past the hour that count as a boundary, e.g. [0, 30]. */
    nearMinutes: number[];
    /** How close (ms) a break's end must land to a boundary to earn an ID. */
    windowMs: number;
  };
  pad: {
    /** Pad each block out to the next multiple of this many minutes. */
    toMinutes: number;
    poolId: string;
  };
  bug?: {
    /** Path to a PNG shown on program content. */
    path: string;
    hideDuringBreaks: boolean;
  };
}

export interface Daypart {
  /** Minutes from local midnight. */
  startMinute: number;
  clockId: string;
}

export interface Channel {
  id: string;
  number: string;
  name: string;
  tvgId: string;
  logo?: string;
  group?: string;
  /** Sorted by startMinute. The last daypart wraps around midnight. */
  dayparts: Daypart[];
  /** Local epoch ms when this channel's timeline began. Simulation runs forward from here. */
  anchorMs: number;
  /** Seed for the channel's random stream. Same seed + same rules = same timeline. */
  seed: string;
}

export interface CursorState {
  /** showId -> index of the next episode to play, in canonical order. */
  showNext: Record<string, number>;
  /** "pool:<id>" -> next index for sequential pools. */
  poolNext: Record<string, number>;
  /** itemId -> channel time (epoch ms) of last play. */
  lastPlayed: Record<string, number>;
  /** Channel time up to which this state is valid. */
  asOf: number;
  /** Show that played most recently, so shuffles avoid back-to-back repeats. */
  lastShowId?: string;
  /** Internal PRNG state so a simulation can resume exactly where it stopped. */
  rngState?: number;
}

export type Role = 'program' | 'commercial' | 'network-id' | 'filler';

export interface TimelineEntry {
  id: string;
  start: number;
  end: number;
  item: MediaItem;
  role: Role;
  inMs: number;
  outMs: number;
  blockId: string;
  /** For program parts: which part of the program this is. */
  partIndex?: number;
  partCount?: number;
  /** For break content: which break of the block. */
  breakIndex?: number;
  /** Human-readable explanation of why the engine placed this entry. */
  reason: string;
}

export interface ScheduledBreak {
  index: number;
  kind: 'mid' | 'post';
  start: number;
  end: number;
  targetMs: number;
  nearBoundary: boolean;
  entries: TimelineEntry[];
}

export interface ScheduledBlock {
  id: string;
  clockId: string;
  start: number;
  end: number;
  programs: MediaItem[];
  breaks: ScheduledBreak[];
  entries: TimelineEntry[];
  contentMs: number;
  breakBudgetMs: number;
}

export interface Ruleset {
  library: Library;
  pools: Pool[];
  clocks: Clock[];
}

export interface Simulation {
  channelId: string;
  blocks: ScheduledBlock[];
  cursors: CursorState;
}

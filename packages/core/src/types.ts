// Domain model for mimicTV. Nothing in here knows about the Next playout JSON shape;
// that lives exclusively in emit/.

export type MediaKind = 'episode' | 'movie' | 'commercial' | 'network-id' | 'bumper' | 'filler';

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
  /** Scan fact: the embedded chapters are ours (titled "Segment N"), not the release's scene marks. */
  chaptersOurs?: boolean;
  /** Decided: no breaks at all, not even the clock's timed fallback. */
  noBreaks?: boolean;
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

/** One set of conditions. Every field present must match. */
export interface FilterTerms {
  /** Free text; every word must appear in the title or path, case-insensitively. */
  text?: string;
  /** Only items inside this folder (path prefix). */
  folder?: string;
  kinds?: MediaKind[];
  showIds?: string[];
  tags?: string[];
  /** Items carrying any of these tags are left out, e.g. ['unnumbered'] to skip extras and movies in show folders. */
  excludeTags?: string[];
  /** Leave out items shorter than this (ms). Unset = no minimum. */
  minDurationMs?: number;
  /** Leave out items longer than this (ms). Unset = no maximum. */
  maxDurationMs?: number;
  /** Only episodes whose season falls in this range (inclusive). Items without a season are kept. */
  seasons?: { min?: number; max?: number };
}

/**
 * A pool's filter is its scope (the top-level terms, all of which must match) plus optional
 * saved searches in `any`: when present, an item must also match at least one of them.
 */
export interface PoolFilter extends FilterTerms {
  any?: FilterTerms[];
}

export interface Pool {
  id: string;
  name: string;
  description?: string;
  /** Set when the pool lives inside one channel's recipe. Unset = shared collection. */
  ownerChannelId?: string;
  filter: PoolFilter;
  selection: SelectionMode;
  /** For random selection: avoid repeating an item within this much channel time. */
  noRepeatMs?: number;
  /** For shows-shuffled: play this many episodes of a show in a row before switching (default 1). */
  runLength?: number;
  /** For random/shuffle interstitials: the no-repeat window also counts plays on other channels. */
  noRepeatAcrossChannels?: boolean;
}

export type BreakFallback =
  | { mode: 'none' }
  | { mode: 'interval'; everyMs: number }
  | { mode: 'offsets'; offsetsMs: number[] };

export interface Clock {
  id: string;
  name: string;
  /** Set when the clock is one channel's band format. Unset = shared preset. */
  ownerChannelId?: string;
  /** Off air: no programs, no ads, no IDs. Each block is one slot of filler from the pad pool. */
  offAir?: boolean;
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
    /** Cut at a program's own break points (chapters, blackdetect, manual) when it has any. */
    atChapters: boolean;
    /**
     * Where to cut when a program has no break points, or when atChapters is off.
     * Offsets and intervals are measured from the start of the program, not the wall clock.
     */
    fallback?: BreakFallback;
    poolId: string;
    /** Spread the pad budget evenly across all breaks (mid + post). */
    equalize: boolean;
    /** When not equalizing, mid-rolls get this target and the post-roll absorbs the rest. */
    midTargetMs: number;
    /** Max commercials per break; 0 = unlimited. */
    maxItems: number;
    /** Ignore break points that would leave a program segment shorter than this (default 3 min). */
    minSegmentMs?: number;
    /**
     * When several programs stack into one slot, insert a break after every N of them.
     * 1 (default) = a break between every program; 0 = never break between programs, only inside them and after the slot.
     */
    betweenPrograms?: number;
    /** Optional bumper pools. Each plays once per break where it applies and comes out of the break's time. */
    bumpers?: {
      /** First thing in every break ("we'll be right back"). */
      before?: string;
      /** Last thing in every break, after the network ID ("now back to the show"). */
      after?: string;
      /** Only in breaks that follow the end of a program ("coming up next"). Plays before `before`. */
      afterProgram?: string;
    };
    /** Use a different commercial pool while certain shows are on. First match wins. */
    overrides?: { showIds: string[]; poolId: string }[];
    /**
     * Pick ads at playback instead of in advance: the emitter writes each break as one Next
     * `dynamic` placeholder that asks mimicTV for items while the break is playing.
     */
    live?: boolean;
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
    /** Pad each block out to the next multiple of this many minutes. 0 = no padding: the block ends when its content ends and breaks are empty. */
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
  /**
   * Set for a fixed show (an appointment): the band runs only until this minute, then whatever
   * band was running resumes. Blocks around it are clamped so it starts exactly on time.
   * Unset = a base band that runs until the next base band starts.
   */
  endMinute?: number;
  /** Days of the week this band applies (0 = Sunday). Unset = every day. */
  days?: number[];
  /** Calendar window this band applies, as "MM-DD" inclusive; may wrap the year end. Unset = all year. */
  dates?: { from: string; to: string };
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
  /** A time-shifted copy of another channel (east/west feeds). The recipe comes from the source. */
  mirrorOf?: string;
  /** For mirrors: how far behind the source this feed runs, in minutes. */
  shiftMinutes?: number;
  /** showId -> episode index the show starts from at the anchor. Set by "jump to" in the UI. */
  cursorSeeds?: Record<string, number>;
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
  /** How many consecutive picks the last show has had, for runLength. */
  runCount?: number;
  /** Internal PRNG state so a simulation can resume exactly where it stopped. */
  rngState?: number;
}

export type Role = 'program' | 'commercial' | 'network-id' | 'bumper' | 'filler';

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
  /** Commercial pool this break drew from (after any per-show override). */
  adPoolId?: string;
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

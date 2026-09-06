// The ONLY module that knows the ErsatzTV Next playout JSON shape (schema 0.0.3).
import type { Clock, ScheduledBlock } from '../types';
import { toCompactIso, toRfc3339Local } from '../time';

export const PLAYOUT_SCHEMA_VERSION = 'https://ersatztv.org/playout/version/0.0.3';

type Source =
  | { source_type: 'local'; path: string; in_point_ms?: number; out_point_ms?: number }
  | { source_type: 'lavfi'; params: string }
  | { source_type: 'dynamic'; uri: string; timeout_us?: number };

interface GraphicsLayer {
  source: Source;
  location: 'bottom_right' | 'bottom_left' | 'top_right' | 'top_left';
  width_percent?: number;
  horizontal_margin_percent?: number;
  vertical_margin_percent?: number;
  opacity_percent?: number;
}

export interface PlayoutItem {
  id: string;
  start: string;
  finish: string;
  source?: Source;
  tracks?: { video?: { source?: Source }; audio?: { source?: Source } };
  graphics?: GraphicsLayer[];
}

export interface PlayoutFile {
  version: string;
  generated_at: string;
  items: PlayoutItem[];
}

export interface EmitOptions {
  clocks: Clock[];
  generatedAt?: number;
  /** Rewrite library paths for the machine running Next, e.g. /media -> /mnt/user/media. */
  pathMap?: (p: string) => string;
  /**
   * When set, breaks on clocks flagged `breaks.live` are written as one `dynamic` placeholder
   * each, pointing at mimicTV's resolver, instead of the pre-picked items.
   */
  dynamic?: { baseUrl: string; channelId: string };
}

export function toPlayout(blocks: ScheduledBlock[], opts: EmitOptions): PlayoutFile {
  const clocks = new Map(opts.clocks.map((c) => [c.id, c]));
  const mapPath = opts.pathMap ?? ((p) => p);
  const items: PlayoutItem[] = [];

  for (const block of blocks) {
    const clock = clocks.get(block.clockId);
    const bug = clock?.bug;
    const live = !!opts.dynamic && !!clock?.breaks.live;
    const liveBreaks = live ? new Set(block.breaks.filter((k) => k.entries.length > 0).map((k) => k.index)) : new Set<number>();
    const emittedBreaks = new Set<number>();
    for (const e of block.entries) {
      if (e.role !== 'program' && e.breakIndex != null && liveBreaks.has(e.breakIndex)) {
        if (emittedBreaks.has(e.breakIndex)) continue;
        emittedBreaks.add(e.breakIndex);
        const k = block.breaks.find((b) => b.index === e.breakIndex)!;
        const q = new URLSearchParams({ pool: k.adPoolId ?? clock!.breaks.poolId, filler: clock!.pad.poolId, ids: clock!.networkId.enabled ? clock!.networkId.poolId : '' });
        items.push({
          id: `${block.id}-live${k.index}`, start: toRfc3339Local(k.start), finish: toRfc3339Local(k.end),
          source: { source_type: 'dynamic', uri: `${opts.dynamic!.baseUrl.replace(/\/$/, '')}/dynamic/${encodeURIComponent(opts.dynamic!.channelId)}?${q}` },
        });
        continue;
      }
      const durationMs = e.end - e.start;
      const item: PlayoutItem = { id: e.id, start: toRfc3339Local(e.start), finish: toRfc3339Local(e.end) };

      if (e.item.still) {
        const seconds = Math.max(1, Math.ceil(durationMs / 1000));
        item.tracks = {
          video: e.item.path
            ? { source: { source_type: 'local', path: mapPath(e.item.path) } }
            : { source: { source_type: 'lavfi', params: `color=c=black:s=1920x1080:r=30:d=${seconds}` } },
          audio: { source: { source_type: 'lavfi', params: `anullsrc=channel_layout=stereo:sample_rate=48000:d=${seconds}` } },
        };
      } else {
        const src: Source = { source_type: 'local', path: mapPath(e.item.path) };
        if (e.inMs > 0) src.in_point_ms = Math.round(e.inMs);
        if (e.outMs < e.item.durationMs) src.out_point_ms = Math.round(e.outMs);
        item.source = src;
      }

      const showBug = bug && (e.role === 'program' || !bug.hideDuringBreaks);
      if (showBug) {
        item.graphics = [{
          source: { source_type: 'local', path: mapPath(bug.path) },
          location: 'bottom_right',
          width_percent: 10,
          horizontal_margin_percent: 2,
          vertical_margin_percent: 2,
          opacity_percent: 80,
        }];
      }
      items.push(item);
    }
  }

  return {
    version: PLAYOUT_SCHEMA_VERSION,
    generated_at: toRfc3339Local(opts.generatedAt ?? Date.now()),
    items,
  };
}

/** Next locates the right file by its name: {start}_{finish}.json in compact ISO 8601. */
export function playoutFileName(startMs: number, finishMs: number): string {
  return `${toCompactIso(startMs)}_${toCompactIso(finishMs)}.json`;
}

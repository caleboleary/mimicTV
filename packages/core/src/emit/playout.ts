// The ONLY module that knows the ErsatzTV Next playout JSON shape (schema 0.0.3).
import type { Clock, ScheduledBlock } from '../types';
import { toCompactIso, toRfc3339Local } from '../time';

export const PLAYOUT_SCHEMA_VERSION = 'https://ersatztv.org/playout/version/0.0.3';

type Source =
  | { source_type: 'local'; path: string; in_point_ms?: number; out_point_ms?: number }
  | { source_type: 'lavfi'; params: string };

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
}

export function toPlayout(blocks: ScheduledBlock[], opts: EmitOptions): PlayoutFile {
  const clocks = new Map(opts.clocks.map((c) => [c.id, c]));
  const mapPath = opts.pathMap ?? ((p) => p);
  const items: PlayoutItem[] = [];

  for (const block of blocks) {
    const bug = clocks.get(block.clockId)?.bug;
    for (const e of block.entries) {
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

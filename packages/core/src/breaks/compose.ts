/** Fold saved break decisions into library items. The scan's own chapters stand for anything undecided. */
import type { Library, MediaItem } from '../types';
import type { ShowBreaks, FileBreaks } from './types';

const rel = (folder: string, p: string): string | undefined => {
  const f = folder.replace(/\/+$/, '') + '/';
  return p.startsWith(f) ? p.slice(f.length) : undefined;
};

/** Find a file's record by path, or by size+duration if it was renamed. */
export function fileBreaks(show: ShowBreaks, relPath: string, item: Pick<MediaItem, 'durationMs' | 'media'>): FileBreaks | undefined {
  const direct = show.files[relPath];
  if (direct) return direct;
  // Only a size + duration match is specific enough to trust across a rename.
  const size = item.media?.sizeBytes;
  if (size == null) return undefined;
  return Object.values(show.files).find((f) => f.key.size === size && f.key.durationMs === item.durationMs);
}

export function applyBreaks(library: Library, shows: ShowBreaks[]): Library {
  if (shows.length === 0) return library;
  const items = library.items.map((item) => {
    for (const show of shows) {
      const r = rel(show.folder, item.path);
      if (r === undefined) continue;
      const f = fileBreaks(show, r, item);
      if (!f?.decision) return item;
      if (f.decision === 'timed') return { ...item, breakPoints: [], breakSource: 'none' as const, noBreaks: undefined };
      if (f.decision === 'none') return { ...item, breakPoints: [], breakSource: 'none' as const, noBreaks: true };
      const at = [...new Set(f.breaks.map((b) => b.at))].filter((ms) => ms > 0 && ms < item.durationMs).sort((a, b) => a - b);
      return { ...item, breakPoints: at, breakSource: f.decision === 'manual' ? 'manual' as const : 'blackdetect' as const, noBreaks: undefined };
    }
    return item;
  });
  return { ...library, items };
}

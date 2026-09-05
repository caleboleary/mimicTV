import type { FilterTerms, Library, MediaItem, Pool, PoolFilter } from '../types';

function inFolder(path: string, folder: string): boolean {
  const f = folder.trim().replace(/[\\/]+$/, '');
  if (!f) return true;
  return path === f || path.startsWith(f + '/') || path.startsWith(f + '\\');
}

function hasText(item: MediaItem, text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${item.title} ${item.path}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Does the item satisfy every condition in this one set of terms? */
export function termsMatch(item: MediaItem, f: FilterTerms): boolean {
  if (f.kinds && f.kinds.length > 0 && !f.kinds.includes(item.kind)) return false;
  if (f.showIds && f.showIds.length > 0 && (!item.showId || !f.showIds.includes(item.showId))) return false;
  if (f.tags && f.tags.length > 0 && !f.tags.every((t) => item.tags.includes(t))) return false;
  if (f.excludeTags && f.excludeTags.some((t) => item.tags.includes(t))) return false;
  if (!item.still && f.minDurationMs != null && item.durationMs < f.minDurationMs) return false;
  if (!item.still && f.maxDurationMs != null && item.durationMs > f.maxDurationMs) return false;
  if (f.seasons && item.season != null) {
    if (f.seasons.min != null && item.season < f.seasons.min) return false;
    if (f.seasons.max != null && item.season > f.seasons.max) return false;
  }
  if (f.folder && !inFolder(item.path, f.folder)) return false;
  if (f.text && !hasText(item, f.text)) return false;
  return true;
}

/** Scope terms must all match; then, if there are saved searches, at least one of them must too. */
export function itemMatches(item: MediaItem, f: PoolFilter): boolean {
  if (!termsMatch(item, f)) return false;
  const rows = f.any?.filter((r) => (r.text && r.text.trim()) || (r.folder && r.folder.trim()) || (r.kinds && r.kinds.length) || (r.showIds && r.showIds.length)) ?? [];
  return rows.length === 0 || rows.some((r) => termsMatch(item, r));
}

export function poolItems(pool: Pool, library: Library): MediaItem[] {
  return library.items.filter((i) => itemMatches(i, pool.filter));
}

/** Every folder that holds matching items, with counts, for "search in" pickers. Sorted by path. */
export function libraryFolders(library: Library, scope?: FilterTerms): { path: string; count: number; depth: number }[] {
  const counts = new Map<string, number>();
  for (const item of library.items) {
    if (scope && !termsMatch(item, scope)) continue;
    const parts = item.path.split(/[\\/]+/);
    for (let d = 3; d < parts.length; d++) { // start below the top-level dir, which is never a useful pick
      const dir = parts.slice(0, d).join('/');
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
  }
  return [...counts].map(([path, count]) => ({ path, count, depth: path.split('/').length - 1 })).sort((a, b) => a.path.localeCompare(b.path));
}

/** Shows represented in the pool, with their episodes in canonical order. */
export function poolShows(pool: Pool, library: Library): { showId: string; episodes: MediaItem[] }[] {
  const items = poolItems(pool, library).filter((i) => i.kind === 'episode' && i.showId);
  const byShow = new Map<string, MediaItem[]>();
  for (const it of items) {
    const arr = byShow.get(it.showId!) ?? [];
    arr.push(it);
    byShow.set(it.showId!, arr);
  }
  const out: { showId: string; episodes: MediaItem[] }[] = [];
  for (const [showId, episodes] of byShow) {
    episodes.sort((a, b) => (a.season! - b.season!) || (a.episode! - b.episode!));
    out.push({ showId, episodes });
  }
  out.sort((a, b) => a.showId.localeCompare(b.showId));
  return out;
}

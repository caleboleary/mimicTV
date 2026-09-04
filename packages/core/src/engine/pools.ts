import type { Library, MediaItem, Pool, PoolFilter } from '../types';

export function itemMatches(item: MediaItem, f: PoolFilter): boolean {
  if (f.kinds && f.kinds.length > 0 && !f.kinds.includes(item.kind)) return false;
  if (f.showIds && f.showIds.length > 0 && (!item.showId || !f.showIds.includes(item.showId))) return false;
  if (f.tags && f.tags.length > 0 && !f.tags.every((t) => item.tags.includes(t))) return false;
  if (f.excludeTags && f.excludeTags.some((t) => item.tags.includes(t))) return false;
  return true;
}

export function poolItems(pool: Pool, library: Library): MediaItem[] {
  return library.items.filter((i) => itemMatches(i, pool.filter));
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

import type { CursorState, Library, MediaItem, Pool } from '../types';
import type { Rng } from '../rng';
import { poolItems, poolShows } from './pools';

/** Built-in fallback when a pad pool can't cover a gap. The engine never leaves a hole. */
export const BLACK: MediaItem = {
  id: '__black__',
  kind: 'filler',
  title: 'Black (engine fallback)',
  path: '',
  durationMs: 0,
  tags: ['filler', 'still'],
  breakPoints: [],
  breakSource: 'none',
  trimmable: true,
  still: true,
};

export class Selector {
  private poolsById: Map<string, Pool>;
  /** Library and pools don't change during a run, so each pool's contents are resolved once. */
  private itemsCache = new Map<string, MediaItem[]>();
  private showsCache = new Map<string, ReturnType<typeof poolShows>>();

  constructor(
    private library: Library,
    pools: Pool[],
    private rng: Rng,
    private cursors: CursorState,
  ) {
    this.poolsById = new Map(pools.map((p) => [p.id, p]));
  }

  pool(id: string): Pool | undefined {
    return this.poolsById.get(id);
  }

  private itemsOf(pool: Pool): MediaItem[] {
    let items = this.itemsCache.get(pool.id);
    if (!items) { items = poolItems(pool, this.library); this.itemsCache.set(pool.id, items); }
    return items;
  }

  private showsOf(pool: Pool): ReturnType<typeof poolShows> {
    let shows = this.showsCache.get(pool.id);
    if (!shows) { shows = poolShows(pool, this.library); this.showsCache.set(pool.id, shows); }
    return shows;
  }

  markPlayed(item: MediaItem, at: number) {
    if (item.id === BLACK.id) return;
    this.cursors.lastPlayed[item.id] = at;
  }

  /**
   * Pick the next program from a program pool, advancing cursors.
   * With `maxMs`, only consider candidates that fit; returns undefined when nothing does.
   */
  pickProgram(poolId: string, now: number, maxMs?: number): { item: MediaItem; reason: string } | undefined {
    const pool = this.poolsById.get(poolId);
    if (!pool) return undefined;

    if (pool.selection === 'shows-shuffled-episodes-in-order') {
      const shows = this.showsOf(pool);
      if (shows.length === 0) return undefined;
      let candidates = shows.length > 1 ? shows.filter((s) => s.showId !== this.cursors.lastShowId) : shows;
      let reasonPrefix = 'Shuffled to';
      if (maxMs != null) {
        const fits = (s: { showId: string; episodes: MediaItem[] }) => {
          const idx = this.cursors.showNext[s.showId] ?? 0;
          return s.episodes[idx % s.episodes.length]!.durationMs <= maxMs;
        };
        // Stacking: pair with the show that just played (two shorts of the same show), else any that fits.
        const same = shows.find((s) => s.showId === this.cursors.lastShowId);
        if (same && fits(same)) { candidates = [same]; reasonPrefix = 'Paired another short from'; }
        else {
          candidates = shows.filter((s) => s.showId !== this.cursors.lastShowId && fits(s));
          if (candidates.length === 0) return undefined;
          reasonPrefix = 'Stacked a fitting episode from';
        }
      }
      const show = this.rng.pick(candidates);
      const idx = this.cursors.showNext[show.showId] ?? 0;
      const ep = show.episodes[idx % show.episodes.length]!;
      this.cursors.showNext[show.showId] = (idx + 1) % show.episodes.length;
      this.cursors.lastShowId = show.showId;
      return { item: ep, reason: `${reasonPrefix} ${show.showId}; cursor was at ${idx + 1}/${show.episodes.length}` };
    }

    const items = this.itemsOf(pool);
    if (items.length === 0) return undefined;

    if (pool.selection === 'sequential') {
      const key = `pool:${pool.id}`;
      const idx = this.cursors.poolNext[key] ?? 0;
      const item = items[idx % items.length]!;
      if (maxMs != null && item.durationMs > maxMs) return undefined;
      this.cursors.poolNext[key] = (idx + 1) % items.length;
      if (item.showId) this.cursors.lastShowId = item.showId;
      return { item, reason: `Sequential pick ${idx + 1}/${items.length}` };
    }

    const fitting = maxMs != null ? items.filter((i) => i.durationMs <= maxMs) : items;
    if (fitting.length === 0) return undefined;
    const item = this.pickRandom(pool, fitting, now);
    if (item.showId) this.cursors.lastShowId = item.showId;
    return { item, reason: pool.selection === 'shuffle' ? 'Shuffle (least recently played)' : 'Random' };
  }

  /**
   * Pick an interstitial that fits in `maxMs`. Trimmable items always fit.
   * Returns undefined when nothing in the pool fits.
   */
  pickInterstitial(
    poolId: string,
    now: number,
    maxMs: number,
    exclude: ReadonlySet<string> = new Set(),
  ): MediaItem | undefined {
    const pool = this.poolsById.get(poolId);
    if (!pool) return undefined;
    const items = this.itemsOf(pool).filter(
      (i) => !exclude.has(i.id) && (i.trimmable || i.durationMs <= maxMs),
    );
    if (items.length === 0) return undefined;
    if (pool.selection === 'sequential') {
      const key = `pool:${pool.id}`;
      const idx = this.cursors.poolNext[key] ?? 0;
      this.cursors.poolNext[key] = (idx + 1) % items.length;
      return items[idx % items.length];
    }
    return this.pickRandom(pool, items, now);
  }

  private pickRandom(pool: Pool, items: MediaItem[], now: number): MediaItem {
    const last = (i: MediaItem) => this.cursors.lastPlayed[i.id] ?? -Infinity;
    if (pool.selection === 'shuffle') {
      // Cycle through everything before repeating: choose among the least recently played.
      const sorted = [...items].sort((a, b) => last(a) - last(b));
      const oldest = last(sorted[0]!);
      const tier = sorted.filter((i) => last(i) === oldest);
      return this.rng.pick(tier.length > 0 ? tier : sorted);
    }
    const noRepeat = pool.noRepeatMs ?? 0;
    const fresh = noRepeat > 0 ? items.filter((i) => now - last(i) >= noRepeat) : items;
    if (fresh.length > 0) return this.rng.pick(fresh);
    // Everything played recently; fall back to the least recently played.
    return [...items].sort((a, b) => last(a) - last(b))[0]!;
  }
}

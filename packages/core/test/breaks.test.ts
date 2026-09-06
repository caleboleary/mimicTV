import { describe, it, expect } from 'vitest';
import { planShow, applyBreaks, candidateCuts, DEFAULT_DETECT, type BlackRow, type EpisodeInput, type ShowBreaks, type Library, type MediaItem } from '../src/index';

const MIN = 60;
const black = (t: number, dur: number, db: number, durSec: number, pre = -25, post = -24): BlackRow => ({ t, dur, frac: t / durSec, db, pre, post });
const ep = (rel: string, durSec: number, blacks: BlackRow[]): EpisodeInput => ({ rel, durationMs: durSec * 1000, blacks });

/** A season of 22-minute episodes with a real break near 11:20 and an intro black at 0:50. */
function season(n: number, seasonName = 'Season 1', breakAt = 11 * MIN + 20, jitter = 8): EpisodeInput[] {
  return Array.from({ length: n }, (_, i) => {
    const d = 22 * MIN + (i % 3);
    const b = breakAt + ((i * 7) % (2 * jitter)) - jitter;
    return ep(`${seasonName}/Show - S01E${String(i + 1).padStart(2, '0')}.mkv`, d, [black(50, 0.4, -40, d), black(b, 1.5, -45, d), black(d - 20, 2, -50, d)]);
  });
}

describe('break planning', () => {
  it('segment mode: a consistent season snaps every episode to the template', () => {
    const plan = planShow(season(12));
    expect(plan.groups).toHaveLength(1);
    const g = plan.groups[0]!;
    expect(g.mode).toBe('segment');
    expect(g.template).toHaveLength(1);
    expect(Math.abs(g.template[0]! - (11 * MIN + 20))).toBeLessThan(10);
    for (const e of g.episodes) {
      expect(e.picks).toHaveLength(1);
      expect(Math.abs(e.picks[0]! / 1000 - (11 * MIN + 20))).toBeLessThan(10);
      expect(e.flags).toEqual([]);
    }
  });

  it('story mode: scattered timings pick the best-scoring middle black per episode', () => {
    const eps = [ep('S1/a.mkv', 22 * MIN, [black(300, 2, -45, 22 * MIN), black(900, 0.3, -20, 22 * MIN)]), ep('S1/b.mkv', 22 * MIN, [black(700, 2.5, -50, 22 * MIN)]), ep('S1/c.mkv', 22 * MIN, [black(1000, 2, -40, 22 * MIN)])];
    const g = planShow(eps).groups[0]!;
    expect(g.mode).toBe('story');
    expect(g.episodes.map((e) => e.picks[0])).toEqual([300000, 700000, 1000000]);
  });

  it('prefers a black 6–15 s before a very quiet title-card black', () => {
    const d = 22 * MIN;
    const eps = season(6).map((e) => ({ ...e, blacks: [...e.blacks!, black(e.blacks![1]!.t - 9, 0.5, -28, d)] }));
    const g = planShow(eps).groups[0]!;
    for (const e of g.episodes) { expect(e.notes.some((n) => n.includes('->'))).toBe(true); expect(e.picks[0]! / 1000).toBeLessThan(11 * MIN + 20); }
  });

  it('groups by season folder and runtime class; outliers and shorts are skipped, extras ignored', () => {
    const eps = [...season(6, 'Season 1'), ...season(6, 'Season 2', 12 * MIN), ep('Season 1/double.mkv', 44 * MIN, []), ep('Season 1/short.mkv', 8 * MIN, []), ep('Extras/bonus.mkv', 22 * MIN, [])];
    const plan = planShow(eps);
    expect(plan.groups.map((g) => `${g.season}|${g.bucket}`)).toEqual(['Season 1|2', 'Season 2|2']);
    expect(plan.skipped.map((s) => s.rel)).toEqual(expect.arrayContaining(['Season 1/double.mkv', 'Season 1/short.mkv', 'Extras/bonus.mkv']));
  });

  it('a two-parter class gets more breaks and a scene cut stands in for a missing black', () => {
    const d = 44 * MIN;
    const eps = Array.from({ length: 4 }, (_, i) => ep(`S1/e${i}.mkv`, d, [black(11 * MIN, 1.5, -45, d), black(22 * MIN, 1.5, -45, d), black(33 * MIN, 1.5, -45, d)]));
    eps[3] = { ...eps[3]!, blacks: [black(11 * MIN, 1.5, -45, d), black(33 * MIN, 1.5, -45, d)], scenes: [{ center: 22 * MIN, cuts: [{ t: 22 * MIN + 3, score: 0.8 }, { t: 22 * MIN - 40, score: 0.9 }], silences: [[22 * MIN + 2, 22 * MIN + 4]] }] };
    const g = planShow(eps).groups[0]!;
    expect(g.breaksPerEpisode).toBe(3);
    expect(g.episodes[3]!.picks).toEqual([11 * MIN * 1000, (22 * MIN + 3) * 1000, 33 * MIN * 1000]);
    expect(g.episodes[3]!.sources[1]).toBe('scene');
  });

  it('an explicit breaks-per-episode caps a segment template', () => {
    const d = 22 * MIN;
    const eps = season(10).map((e) => ({ ...e, blacks: [...e.blacks!, black(6 * MIN, 1, -40, d)] })); // a second consistent fade
    expect(planShow(eps).groups[0]!.template).toHaveLength(2);
    expect(planShow(eps, { breaksPerEpisode: 1 }).groups[0]!.template).toHaveLength(1);
  });

  it('rejected offsets are not proposed again', () => {
    const eps = season(6).map((e) => ({ ...e, rejected: [e.blacks![1]!.t * 1000] }));
    const g = planShow(eps).groups[0]!;
    expect(g.episodes.every((e) => e.picks.length === 0 || Math.abs(e.picks[0]! - (11 * MIN + 20) * 1000) > 10000)).toBe(true);
  });
});

describe('applying decisions to the library', () => {
  const item = (path: string, over: Partial<MediaItem> = {}): MediaItem => ({ id: path, kind: 'episode', title: path, path, durationMs: 22 * MIN * 1000, tags: [], breakPoints: [600000], breakSource: 'chapters', ...over });
  const library: Library = { shows: [], items: [item('/media/TV/Show/S1/a.mkv'), item('/media/TV/Show/S1/b.mkv'), item('/media/TV/Show/S1/c.mkv'), item('/media/TV/Show/S1/renamed.mkv', { media: { sizeBytes: 123 } }), item('/media/TV/Other/x.mkv')] };
  const show: ShowBreaks = { version: 1, folder: '/media/TV/Show', settings: {}, files: {
    'S1/a.mkv': { key: { durationMs: 22 * MIN * 1000 }, decision: 'detected', breaks: [{ at: 700000, source: 'detected' }], rejected: [] },
    'S1/b.mkv': { key: { durationMs: 22 * MIN * 1000 }, decision: 'none', breaks: [], rejected: [] },
    'S1/old-name.mkv': { key: { durationMs: 22 * MIN * 1000, size: 123 }, decision: 'manual', breaks: [{ at: 800000, source: 'manual' }], rejected: [] },
  } };
  const out = applyBreaks(library, [show]);
  const by = (p: string) => out.items.find((i) => i.path === p)!;
  it('decided files get their breaks; undecided keep the scan\'s chapters; other shows untouched', () => {
    expect(by('/media/TV/Show/S1/a.mkv').breakPoints).toEqual([700000]);
    expect(by('/media/TV/Show/S1/a.mkv').breakSource).toBe('blackdetect');
    expect(by('/media/TV/Show/S1/c.mkv').breakPoints).toEqual([600000]);
    expect(by('/media/TV/Other/x.mkv').breakPoints).toEqual([600000]);
  });
  it('a renamed file re-attaches by size and duration', () => {
    expect(by('/media/TV/Show/S1/renamed.mkv').breakPoints).toEqual([800000]);
    expect(by('/media/TV/Show/S1/renamed.mkv').breakSource).toBe('manual');
  });
  it('"none" beats the clock\'s timed fallback', () => {
    const b = by('/media/TV/Show/S1/b.mkv');
    expect(b.noBreaks).toBe(true);
    expect(candidateCuts(b, { atChapters: true, fallback: { mode: 'interval', everyMs: 480000 }, poolId: 'x', equalize: true, midTargetMs: 0, maxItems: 0 } as never)).toEqual([]);
  });
  it('defaults are sane', () => { expect(DEFAULT_DETECT.tol).toBe(75); });
});

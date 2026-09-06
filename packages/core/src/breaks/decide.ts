/**
 * Decide where breaks go, from measured blacks. A faithful port of chapterize.py's planning half,
 * plus the fixes its issues list asked for: outliers judged per season folder and runtime class,
 * and a scene-cut fallback when the break has no black frame. Pure: the UI re-runs it on every knob.
 */
import type { BlackRow, DetectSettings, SceneWindow } from './types';
import { DEFAULT_DETECT } from './types';

export interface EpisodeInput {
  /** Path relative to the show folder. */
  rel: string;
  durationMs: number;
  blacks?: BlackRow[];
  scenes?: SceneWindow[];
  /** Offsets (ms) the user rejected earlier. */
  rejected?: number[];
}

export interface EpisodePlan {
  rel: string;
  durationMs: number;
  /** Break offsets, ms, sorted. */
  picks: number[];
  /** Which measurement each pick came from, parallel to `picks`. */
  sources: ('detected' | 'scene')[];
  /** Lower-confidence: the UI shows these first. */
  flags: string[];
  notes: string[];
  /** Not planned, and why. */
  skipped?: string;
  /** Segment mode: template centres this episode had nothing near (candidates for a scene-cut pass). */
  unmatched: number[];
}

export interface GroupPlan {
  /** Season folder name, or "(root)". */
  season: string;
  /** Runtime class: 1 = one short (~11 min), 2 = a 22-min episode, 4 = a two-parter. */
  bucket: number;
  mode: 'segment' | 'story';
  /** Template centres, seconds, in segment mode. */
  template: number[];
  secondary: number[];
  clusters: { center: number; n: number; cov: number; early: boolean }[];
  breaksPerEpisode: number;
  episodes: EpisodePlan[];
}

export interface ShowPlan { groups: GroupPlan[]; skipped: { rel: string; why: string }[] }

const EXTRAS_RE = /extra|special|featurette|misc|xtra|bonus|trailer|sample|^season 0+$|^s00$/i;

export const seasonOf = (rel: string): string => (rel.includes('/') ? rel.split('/')[0]! : '(root)');
/** Runtime class: how many ~11.5-minute units the file holds. */
export const bucket = (durSec: number): number => Math.max(1, Math.round(durSec / 690));
export const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const median = (xs: number[]): number => { const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2; };
/** 0 at `floor` dB, +1 for every `per` dB quieter. */
const q = (db: number, floor = -18, per = 10): number => Math.max(0, (-db + floor) / per);

/** Story-mode score: long, quiet, faded in and out, near the middle. */
export function score(r: BlackRow): number {
  return 2 * Math.min(r.dur, 3) + q(r.db) + q(r.pre, -22, 8) + q(r.post, -22, 8) - 3 * Math.abs(r.frac - 0.5);
}

/** The real cut is often 6–15 s before a very quiet title-card black; use it if present. */
function pullLeft(cands: BlackRow[], pick: BlackRow, s: DetectSettings): BlackRow {
  const prev = cands.filter((c) => pick.t - c.t >= s.pullMin && pick.t - c.t <= s.pullMax);
  return prev.length ? prev[prev.length - 1]! : pick;
}

/** Peak-finding: repeatedly take the time where the most episodes have a quiet black nearby. */
export function segmentClusters(eps: { durSec: number; blacks: BlackRow[] }[], s: DetectSettings): GroupPlan['clusters'] {
  let pts = eps.flatMap((ep, k) => ep.blacks.filter((r) => r.db <= s.quiet).map((r) => ({ k, t: r.t })));
  const medDur = median(eps.map((e) => e.durSec));
  const out: GroupPlan['clusters'] = [];
  while (pts.length) {
    let best = 0, bestEps = new Set<number>();
    for (const { t: t0 } of pts) {
      const near = new Set(pts.filter((p) => Math.abs(p.t - t0) <= s.tol / 2).map((p) => p.k));
      if (near.size > bestEps.size) { best = t0; bestEps = near; }
    }
    if (bestEps.size < Math.max(2, 0.15 * eps.length)) break;
    const center = median(pts.filter((p) => Math.abs(p.t - best) <= s.tol / 2).map((p) => p.t));
    const early = center < 0.1 * medDur || center > 0.9 * medDur;
    out.push({ center, n: bestEps.size, cov: bestEps.size / eps.length, early });
    pts = pts.filter((p) => !(bestEps.has(p.k) && Math.abs(p.t - center) <= s.tol));
  }
  return out.sort((a, b) => a.center - b.center);
}

/** Strongest scene cut beside a silence in a measured window: the fallback when no black marks the break. */
export function pickScene(w: SceneWindow, tol: number): { t: number; quiet: boolean } | undefined {
  const quiet = (t: number) => w.silences.some(([a, b]) => t >= a - 1 && t <= b + 1);
  const ranked = [...w.cuts].sort((x, y) => (Number(quiet(y.t)) - Number(quiet(x.t))) || ((y.score - Math.abs(y.t - w.center) / tol) - (x.score - Math.abs(x.t - w.center) / tol)));
  return ranked[0] ? { t: ranked[0].t, quiet: quiet(ranked[0].t) } : undefined;
}

type Pick = { t: number; source: 'detected' | 'scene' };

function pickSegment(ep: EpisodeInput, blacks: BlackRow[], centers: number[], s: DetectSettings, secondary: number[] = []): { picks: Pick[]; flags: string[]; notes: string[]; unmatched: number[] } {
  const picks: Pick[] = [], flags: string[] = [], notes: string[] = [], unmatched: number[] = [];
  let weak = 0;
  for (const c of centers) {
    const near = blacks.filter((r) => Math.abs(r.t - c) <= s.tol && r.db <= s.loud);
    if (!near.length) {
      const w = ep.scenes?.find((x) => Math.abs(x.center - c) < 1);
      const sc = w && pickScene(w, s.tol);
      if (sc) { picks.push({ t: sc.t, source: 'scene' }); notes.push(`scene cut at ${mmss(sc.t)}${sc.quiet ? ' (silent)' : ''} stands in for a missing black near ${mmss(c)}`); if (!sc.quiet) weak++; }
      else { flags.push(`no usable black near ${mmss(c)}`); unmatched.push(c); }
      continue;
    }
    const quiet = near.filter((r) => r.db <= s.quiet);
    const pool = quiet.length ? quiet : near;
    const anchor = pool.reduce((a, r) => (Math.abs(r.t - c) < Math.abs(a.t - c) ? r : a));
    if (!quiet.length) { flags.push(`nothing quiet near ${mmss(c)}, used ${mmss(anchor.t)}`); weak++; }
    const p = pullLeft(near, anchor, s);
    if (p !== anchor) notes.push(`${mmss(anchor.t)}->${mmss(p.t)}`);
    picks.push({ t: p.t, source: 'detected' });
  }
  if (secondary.length && (!picks.length || weak === picks.length)) {
    // Nothing (or only noisy fallbacks) matched the main template: try the alternate.
    const alt = pickSegment(ep, blacks, secondary, s);
    const strong = alt.picks.length - alt.flags.filter((f) => f.startsWith('nothing quiet')).length;
    if (alt.picks.length && strong > 0) {
      alt.notes.push('used alternate template ' + secondary.map(mmss).join('/'));
      return alt;
    }
  }
  // Informational: where else the episode goes quiet. When a centre had no usable black, one of these is usually the break.
  const extra = blacks.filter((r) => r.db <= s.quiet && centers.every((c) => Math.abs(r.t - c) > s.tol)).map((r) => r.t);
  if (extra.length) notes.push('other quiet blacks at ' + extra.map(mmss).join(' '));
  // Two template centres can snap to the same black: keep breaks >= 60 s apart.
  const dedup: Pick[] = [];
  for (const p of [...picks].sort((a, b) => a.t - b.t)) if (!dedup.length || p.t - dedup[dedup.length - 1]!.t >= 60) dedup.push(p);
  if (dedup.length < picks.length) notes.push(`dropped ${picks.length - dedup.length} duplicate pick(s)`);
  return { picks: dedup, flags: [...new Set(flags)], notes, unmatched };
}

function pickStory(blacks: BlackRow[], s: DetectSettings, breaks: number): { picks: Pick[]; flags: string[]; notes: string[] } {
  const [lo, hi] = s.band;
  const cands = blacks.filter((r) => r.frac >= lo && r.frac <= hi && r.db <= s.loud);
  const flags: string[] = [], notes: string[] = [];
  if (!cands.length) return { picks: [], flags: ['no candidates in the middle of the episode'], notes };
  const ranked = [...cands].sort((a, b) => score(b) - score(a));
  const picks: Pick[] = [], used: number[] = [];
  for (const r of ranked) {
    if (picks.length >= breaks) break;
    if (used.some((u) => Math.abs(r.t - u) < 60)) continue; // don't take two from one transition
    const p = pullLeft(cands, r, s);
    if (p !== r) notes.push(`${mmss(r.t)}->${mmss(p.t)}`);
    picks.push({ t: p.t, source: 'detected' }); used.push(r.t);
  }
  // Confidence: is there a clear gap between the last accepted and the first rejected?
  const rest = ranked.filter((r) => !used.includes(r.t));
  if (rest.length && used.length) {
    const margin = score(ranked.find((r) => r.t === used[used.length - 1])!) - score(rest[0]!);
    if (margin < 1) flags.push('close call: ' + ranked.slice(0, 4).map((r) => `${mmss(r.t)}(${score(r).toFixed(1)})`).join(' '));
  }
  return { picks: picks.sort((a, b) => a.t - b.t), flags, notes };
}

/** Plan a whole show. Episodes without measurements are skipped, not guessed. */
export function planShow(episodes: EpisodeInput[], overrides: Partial<DetectSettings> = {}): ShowPlan {
  const s: DetectSettings = { ...DEFAULT_DETECT, ...overrides };
  const skipped: ShowPlan['skipped'] = [];
  const all = episodes.filter((e) => e.durationMs > 0);
  let files = all.filter((e) => !EXTRAS_RE.test(seasonOf(e.rel)));
  if (!files.length) files = all;
  for (const e of all) if (!files.includes(e)) skipped.push({ rel: e.rel, why: 'extras folder' });

  const durSec = (e: EpisodeInput) => e.durationMs / 1000;
  const eligible: EpisodeInput[] = [];
  for (const e of files) {
    const season = seasonOf(e.rel);
    const peers = files.filter((g) => seasonOf(g.rel) === season && bucket(durSec(g)) === bucket(durSec(e)));
    if (files.length > 1 && peers.length < 2) { skipped.push({ rel: e.rel, why: `no other file in ${season} runs ${Math.round(durSec(e) / 60)} min: outlier` }); continue; }
    if (bucket(durSec(e)) === 1 && durSec(e) < s.short * 60) { skipped.push({ rel: e.rel, why: 'short: no breaks wanted' }); continue; }
    eligible.push(e);
  }

  // Group by season folder and runtime class, so two-part / double-short files are judged against their own kind.
  const groups = new Map<string, EpisodeInput[]>();
  for (const e of eligible) { const key = `${seasonOf(e.rel)}|${bucket(durSec(e))}`; groups.set(key, [...(groups.get(key) ?? []), e]); }

  const out: GroupPlan[] = [];
  for (const [key, geps0] of groups) {
    const [season, b] = key.split('|') as [string, string];
    const med = median(geps0.map(durSec));
    const geps = geps0.filter((e) => { const odd = durSec(e) > 1.6 * med || durSec(e) < 0.6 * med; if (odd) skipped.push({ rel: e.rel, why: `${Math.round(durSec(e) / 60)} min where the season's median is ${Math.round(med / 60)} min: do this one by hand` }); return !odd; });
    if (!geps.length) continue;
    const breaks = Math.max(s.breaksPerEpisode ?? 1, bucket(med) - 1); // a 46-min two-parter gets 3 breaks, a 23-min episode 1
    const measured = geps.filter((e) => e.blacks);
    const clusters = segmentClusters(measured.map((e) => ({ durSec: durSec(e), blacks: e.blacks! })), s);
    let template = clusters.filter((c) => !c.early && c.cov >= s.coverage).map((c) => c.center);
    // An explicit breaks-per-episode caps the template to the best-covered centres (a show with many in-segment fades).
    if (s.breaksPerEpisode != null && template.length > s.breaksPerEpisode) {
      template = [...clusters.filter((c) => template.includes(c.center))].sort((a, b) => b.cov - a.cov).slice(0, s.breaksPerEpisode).map((c) => c.center).sort((a, b) => a - b);
    }
    const secondary = clusters.filter((c) => !c.early && !template.includes(c.center)).map((c) => c.center);
    const mode: GroupPlan['mode'] = template.length ? 'segment' : 'story';
    const plans: EpisodePlan[] = geps.map((e) => {
      if (!e.blacks) return { rel: e.rel, durationMs: e.durationMs, picks: [], sources: [], flags: [], notes: [], skipped: 'not measured yet', unmatched: [] };
      const blacks = e.blacks.filter((r) => !(e.rejected ?? []).some((rj) => Math.abs(rj - r.t * 1000) < 500));
      const r = mode === 'segment' ? pickSegment(e, blacks, template, s, secondary) : { ...pickStory(blacks, s, breaks), unmatched: [] };
      return { rel: e.rel, durationMs: e.durationMs, picks: r.picks.map((p) => Math.round(p.t * 1000)), sources: r.picks.map((p) => p.source), flags: r.flags, notes: r.notes, unmatched: r.unmatched };
    });
    out.push({ season, bucket: Number(b), mode, template, secondary, clusters, breaksPerEpisode: breaks, episodes: plans });
  }
  out.sort((a, b) => a.season.localeCompare(b.season) || a.bucket - b.bucket);
  return { groups: out, skipped };
}

/** One line per group for the UI: "breaks at ~7:05 and ~14:30 in 22/24 episodes". */
export function describeGroup(g: GroupPlan): string {
  const n = g.episodes.filter((e) => !e.skipped).length;
  if (g.mode === 'segment') {
    const cov = g.clusters.filter((c) => g.template.includes(c.center));
    const seen = Math.min(...cov.map((c) => c.n));
    return `breaks at ${g.template.map((t) => '~' + mmss(t)).join(' and ')} in ${seen}/${n} episodes`;
  }
  return `timings differ per episode: best ${g.breaksPerEpisode} break${g.breaksPerEpisode === 1 ? '' : 's'} each, from the middle of the runtime`;
}

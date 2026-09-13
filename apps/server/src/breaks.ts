/**
 * Break points: per-show JSON under data/breaks/, background measurement jobs (ffmpeg, one show at
 * a time with the rest queued), and the composition of saved decisions into the library everything
 * else reads. Never writes to media. See docs/breaks.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  applyBreaks, planShow, slug, DEFAULT_DETECT, admitAnalyze, advanceAnalyze, dequeueAnalyze,
  type AnalyzeAdmission, type AnalyzeQueue, type BlackRow, type DetectSettings, type EpisodeInput, type Library, type MediaItem, type SceneWindow, type ShowBreaks,
} from '@mimictv/core';
import { DATA, readJson, writeJsonAtomic } from './store';

export const BREAKS_DIR = path.join(DATA, 'breaks');
const EXTRAS_RE = /extra|special|featurette|misc|xtra|bonus|trailer|sample|^season 0+$|^s00$/i;

// ---- storage -----------------------------------------------------------------------------------
export const slugFor = (folder: string) => slug(path.basename(folder)) || slug(folder);
const fileFor = (folder: string) => path.join(BREAKS_DIR, `${slugFor(folder)}.json`);

export function loadShow(folder: string): ShowBreaks {
  return readJson<ShowBreaks>(fileFor(folder)) ?? { version: 1, folder, settings: {}, files: {} };
}
export function saveShow(show: ShowBreaks): void { writeJsonAtomic(fileFor(show.folder), show); }
export function loadAll(): ShowBreaks[] {
  if (!fs.existsSync(BREAKS_DIR)) return [];
  return fs.readdirSync(BREAKS_DIR).filter((f) => f.endsWith('.json')).map((f) => readJson<ShowBreaks>(path.join(BREAKS_DIR, f))).filter((s): s is ShowBreaks => !!s && s.version === 1);
}
/** The library with every saved decision folded in: what the engine, publish, and the app see. */
export function composed(raw: Library): Library { return applyBreaks(raw, loadAll()); }

const rel = (folder: string, p: string) => p.slice(folder.replace(/\/+$/, '').length + 1);
export const episodesUnder = (library: Library, folder: string): MediaItem[] => {
  const f = folder.replace(/\/+$/, '') + '/';
  return library.items.filter((i) => i.kind === 'episode' && i.path.startsWith(f));
};

// ---- ffmpeg ------------------------------------------------------------------------------------
const children = new Set<ChildProcess>();
function ff(ffmpeg: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const [cmd, ...pre] = ffmpeg.split(/\s+/);
    const child = spawn(cmd!, [...pre, '-hide_banner', '-nostdin', '-nostats', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', () => { children.delete(child); resolve(out); });
    child.on('close', () => { children.delete(child); resolve(out); });
  });
}

async function blacks(ffmpeg: string, file: string, s: DetectSettings, durSec: number): Promise<BlackRow[]> {
  const out = await ff(ffmpeg, ['-an', '-i', file, '-vf', `scale=160:-2,blackdetect=d=${s.minBlack}:pix_th=${s.pix}`, '-f', 'null', '-']);
  const merged: [number, number][] = [];
  for (const m of out.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)) {
    const st = Number(m[1]), en = Number(m[2]);
    // A flicker inside a fade is still one break: merge blacks that touch.
    if (merged.length && st - merged[merged.length - 1]![1] <= 1.5) merged[merged.length - 1]![1] = en; else merged.push([st, en]);
  }
  const rows: BlackRow[] = [];
  for (const [st, en] of merged) {
    if (!(st > s.edge && st < durSec - s.edge)) continue;
    const db = await loudness(ffmpeg, file, st, Math.max(en - st, 0.5));
    const pre = await loudness(ffmpeg, file, st - 2, 1.5);
    const post = await loudness(ffmpeg, file, en + 0.5, 1.5);
    rows.push({ t: st, dur: en - st, frac: st / durSec, db, pre, post });
  }
  return rows;
}

async function loudness(ffmpeg: string, file: string, start: number, len: number): Promise<number> {
  const out = await ff(ffmpeg, ['-ss', Math.max(start, 0).toFixed(3), '-t', len.toFixed(3), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
  const m = out.match(/mean_volume:\s*(-?[\d.]+) dB/);
  return m ? Number(m[1]) : 0;
}

/** Scene cuts and silences in a window: what stands in for a break with no black frame. */
async function scenes(ffmpeg: string, file: string, center: number, tol: number): Promise<SceneWindow> {
  const ss = Math.max(0, center - tol);
  const out = await ff(ffmpeg, ['-ss', ss.toFixed(2), '-t', (2 * tol).toFixed(2), '-i', file, '-vf', "scale=160:-2,select='gt(scene,0.35)',metadata=print", '-af', 'silencedetect=n=-32dB:d=0.25', '-f', 'null', '-']);
  const cuts = [...out.matchAll(/pts_time:([\d.]+)\n.*?scene_score=([\d.]+)/g)].map((m) => ({ t: ss + Number(m[1]), score: Number(m[2]) }));
  const silences = [...out.matchAll(/silence_start: ([\d.]+)\n.*?silence_end: ([\d.]+)/gs)].map((m) => [ss + Number(m[1]), ss + Number(m[2])] as [number, number]);
  return { center, cuts, silences };
}

// ---- measurement job -----------------------------------------------------------------------------
export interface BreaksJob {
  running: boolean;
  folder?: string;
  total: number;
  done: number;
  current?: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  /** Second pass: scene windows for template centres that had no black. */
  phase?: 'blacks' | 'scenes';
}
const job: BreaksJob = { running: false, total: 0, done: 0 };
let cancelled = false;

/** One analysis waiting its turn: everything the job needs when its turn comes. */
interface AnalyzeRequest { ffmpeg: string; library: Library; folder: string; overrides: Partial<DetectSettings>; force: boolean }
const aq: AnalyzeQueue<AnalyzeRequest> = { pending: [] };

/** The job in progress plus the show folders queued behind it. */
export interface BreaksStatus extends BreaksJob { queue: string[] }
export const breaksStatus = (): BreaksStatus => ({ ...job, queue: aq.pending.map((r) => r.folder) });
export function cancelAnalyze(): void { cancelled = true; for (const c of children) c.kill('SIGKILL'); }

const sameSettings = (a: { minBlack: number; pix: number; edge: number } | undefined, s: DetectSettings) => !!a && a.minBlack === s.minBlack && a.pix === s.pix && a.edge === s.edge;

/** Which files a run would measure, and a wall-clock estimate, so the UI can warn before starting. */
export function analyzePlan(library: Library, folder: string, overrides: Partial<DetectSettings> = {}, force = false): { files: string[]; minutes: number; skipped: { rel: string; why: string }[] } {
  const s: DetectSettings = { ...DEFAULT_DETECT, ...loadShow(folder).settings, ...overrides };
  const show = loadShow(folder);
  const eps = episodesUnder(library, folder);
  const inputs: EpisodeInput[] = eps.map((i) => ({ rel: rel(folder, i.path), durationMs: i.durationMs }));
  const plan = planShow(inputs, s);
  const eligible = new Set(plan.groups.flatMap((g) => g.episodes.map((e) => e.rel)));
  const files = eps.filter((i) => eligible.has(rel(folder, i.path)) && (force || !sameSettings(show.files[rel(folder, i.path)]?.measured?.settings, s)));
  // ~1.55 s of ffmpeg per minute of 1080p video on a modest CPU, two files at a time.
  const minutes = Math.ceil((files.reduce((n, i) => n + i.durationMs, 0) / 60000) * 1.55 / 2 / 60);
  return { files: files.map((i) => rel(folder, i.path)), minutes, skipped: plan.skipped };
}

/** Start the run at the head of the queue; when it ends, the next queued show takes its place. */
function runQueued(): void {
  const r = aq.running;
  if (!r) return;
  void analyzeShow(r.ffmpeg, r.library, r.folder, r.overrides, r.force)
    .catch((e) => console.error('[breaks] analyze failed', e))
    .finally(() => { if (advanceAnalyze(aq)) runQueued(); });
}

/** Queue one show's measurement; starts now if nothing is running or waiting. A second request for
 * the running show is refused (its run is going on), a re-request for a queued one updates it. */
export function requestAnalyze(ffmpeg: string, library: Library, folder: string, overrides: Partial<DetectSettings> = {}, force = false): AnalyzeAdmission {
  const a = admitAnalyze(aq, { ffmpeg, library, folder, overrides, force });
  if (a.status === 'started') runQueued();
  return a;
}

/** Pull a show out of the queue; false if it wasn't waiting. The running show keeps running. */
export function unqueueAnalyze(folder: string): boolean { return dequeueAnalyze(aq, folder); }

/** One show's measurement run; the queue admits one at a time, so nothing else is running here. */
export async function analyzeShow(ffmpeg: string, library: Library, folder: string, overrides: Partial<DetectSettings> = {}, force = false, concurrency = 2): Promise<void> {
  const show = loadShow(folder);
  show.settings = { ...show.settings, ...overrides };
  const s: DetectSettings = { ...DEFAULT_DETECT, ...show.settings };
  const eps = episodesUnder(library, folder);
  const byRel = new Map(eps.map((i) => [rel(folder, i.path), i]));
  const todo = analyzePlan(library, folder, overrides, force).files;
  Object.assign(job, { running: true, folder, total: todo.length, done: 0, current: undefined, startedAt: Date.now(), finishedAt: undefined, error: undefined, phase: 'blacks' });
  cancelled = false;
  try {
    let next = 0;
    const worker = async () => {
      for (;;) {
        if (cancelled) return;
        const r = todo[next++]; if (!r) return;
        const item = byRel.get(r)!;
        job.current = path.basename(item.path);
        const rows = await blacks(ffmpeg, item.path, s, item.durationMs / 1000);
        if (cancelled) return;
        const prev = show.files[r];
        show.files[r] = { key: { size: item.media?.sizeBytes, durationMs: item.durationMs }, decision: prev?.decision, breaks: prev?.breaks ?? [], rejected: prev?.rejected ?? [], measured: { at: new Date().toISOString(), settings: { minBlack: s.minBlack, pix: s.pix, edge: s.edge }, blacks: rows } };
        saveShow(show); // progress survives a restart
        job.done++;
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    if (cancelled) return;

    // Second pass: where the season template has a centre with no black in an episode, look for a scene cut there.
    job.phase = 'scenes';
    const inputs: EpisodeInput[] = eps.map((i) => { const f = show.files[rel(folder, i.path)]; return { rel: rel(folder, i.path), durationMs: i.durationMs, blacks: f?.measured?.blacks, scenes: f?.measured?.scenes, rejected: f?.rejected }; });
    const plan = planShow(inputs, s);
    const wanted = plan.groups.flatMap((g) => g.episodes.filter((e) => e.unmatched.length).map((e) => ({ rel: e.rel, centers: e.unmatched })));
    job.total += wanted.length; 
    for (const w of wanted) {
      if (cancelled) return;
      const f = show.files[w.rel]; const item = byRel.get(w.rel);
      if (!f?.measured || !item) { job.done++; continue; }
      job.current = path.basename(item.path);
      const have = f.measured.scenes ?? [];
      for (const c of w.centers) if (!have.some((x) => Math.abs(x.center - c) < 1)) have.push(await scenes(ffmpeg, item.path, c, s.tol));
      f.measured.scenes = have;
      saveShow(show);
      job.done++;
    }
  } catch (e) {
    job.error = (e as Error).message;
  } finally {
    job.running = false; job.finishedAt = Date.now(); job.current = undefined; job.phase = undefined;
  }
}

// ---- one-time imports --------------------------------------------------------------------------
/**
 * Seed measurements from chapterize.py's scan cache (path|size|mtime|minBlack|pix|edge -> rows), for files
 * that still match on size and mtime. Saves hours of ffmpeg for anyone who used that tool.
 */
export function seedFromChapterizeCache(library: Library, cachePath: string): { imported: number; stale: number; unknown: number } {
  const cache = readJson<Record<string, BlackRow[]>>(cachePath);
  if (!cache) throw new Error(`Cannot read ${cachePath}`);
  const byPath = new Map(library.items.map((i) => [i.path, i]));
  const shows = new Map<string, ShowBreaks>();
  let imported = 0, stale = 0, unknown = 0;
  for (const [key, rows] of Object.entries(cache)) {
    const [p, size, mtime, minBlack, pix, edge] = key.split('|');
    const item = p && byPath.get(p);
    if (!item) { unknown++; continue; }
    let st: fs.Stats;
    try { st = fs.statSync(item.path); } catch { unknown++; continue; }
    // Same size and mtime is proof. Otherwise the file was rewritten (the old tool stream-copied chapters in), which
    // leaves the picture untouched: accept when the rows' implied duration still matches the library's.
    const exact = String(st.size) === size && String(Math.floor(st.mtimeMs / 1000)) === mtime;
    const implied = rows[0] ? (rows[0].t / rows[0].frac) * 1000 : undefined;
    if (!exact && !(implied != null && Math.abs(implied - item.durationMs) < 1500)) { stale++; continue; }
    // Find the show folder: the item's path under the root it was scanned from is tags[1]'s folder; use the second path level.
    const folder = item.path.split('/').slice(0, 4).join('/');
    const show = shows.get(folder) ?? loadShow(folder);
    const r = rel(folder, item.path);
    const prev = show.files[r];
    show.files[r] = { key: { size: st.size, durationMs: item.durationMs }, decision: prev?.decision, breaks: prev?.breaks ?? [], rejected: prev?.rejected ?? [], measured: prev?.measured ?? { at: new Date(st.mtimeMs).toISOString(), settings: { minBlack: Number(minBlack), pix: Number(pix), edge: Number(edge) }, blacks: rows } };
    shows.set(folder, show);
    imported++;
  }
  for (const show of shows.values()) saveShow(show);
  return { imported, stale, unknown };
}

/** Chapters the old in-place tool wrote ("Segment N") were accepted picks: keep them as manual decisions. */
export function importEmbedded(library: Library, folder: string): number {
  const show = loadShow(folder);
  let n = 0;
  for (const item of episodesUnder(library, folder)) {
    if (!item.chaptersOurs || item.breakPoints.length === 0) continue;
    const r = rel(folder, item.path);
    const prev = show.files[r];
    if (prev?.decision) continue;
    show.files[r] = { key: { size: item.media?.sizeBytes, durationMs: item.durationMs }, decision: 'manual', breaks: item.breakPoints.map((at) => ({ at, source: 'embedded' as const })), rejected: prev?.rejected ?? [], measured: prev?.measured };
    n++;
  }
  if (n) saveShow(show);
  return n;
}

/** Show folders: the level under each library root that holds episodes. */
export function showFolders(library: Library): { folder: string; episodes: number; decided: number; measured: number; ours: number; release: number }[] {
  const all = loadAll();
  const byFolder = new Map<string, MediaItem[]>();
  for (const i of library.items) {
    if (i.kind !== 'episode') continue;
    const folder = i.path.split('/').slice(0, 4).join('/');
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), i]);
  }
  return [...byFolder].map(([folder, items]) => {
    const show = all.find((s) => s.folder === folder);
    const files = items.map((i) => show?.files[rel(folder, i.path)]);
    return {
      folder, episodes: items.length,
      decided: files.filter((f) => f?.decision).length,
      measured: files.filter((f) => f?.measured).length,
      ours: items.filter((i) => i.chaptersOurs).length,
      release: items.filter((i) => i.breakSource === 'chapters' && !i.chaptersOurs && !EXTRAS_RE.test(rel(folder, i.path).split('/')[0] ?? '')).length,
    };
  }).sort((a, b) => a.folder.localeCompare(b.folder));
}

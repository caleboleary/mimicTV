/**
 * mimicTV service: holds rules/library/settings, scans folders with ffprobe, writes Next's
 * files on a schedule, and resolves live breaks. Plain node:http, no framework.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { poolItems, rngFor, visibleLibrary, parseProbeJsonl, importProbeLibrary, type MediaItem, type PlayoutItem } from '@mimictv/core';
import { store, files, IMPORTS, DATA, type Settings, type RulesSnapshot, type LibraryFile } from './store';
import { runScan, scanStatus } from './scan';
import { publishNow, lastPublish } from './publish';
import { composed, loadShow, saveShow, showFolders, analyzePlan, analyzeShow, breaksStatus, cancelAnalyze, seedFromChapterizeCache, importEmbedded } from './breaks';
import type { ShowBreaks } from '@mimictv/core';

const PORT = Number(process.env.PORT ?? 8787);

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>, url: URL) => void | Promise<void>;
const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];
function route(method: string, pattern: string, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, pattern: re, keys, handler });
}
function json(res: http.ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}
function body(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => { const chunks: Buffer[] = []; req.on('data', (c: Buffer) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); });
}

// ---- rules / library / settings
route('GET', '/api/rules', (_r, res) => json(res, store.rules() ?? {}));
/** Only these parts of a rules snapshot change the schedule; the preview date or selection do not. */
const scheduleRules = (r: RulesSnapshot | undefined) => JSON.stringify(r ? [r.pools, r.clocks, r.channels, r.hiddenFolders ?? []] : null);
route('PUT', '/api/rules', async (req, res) => {
  const next = JSON.parse((await body(req)).toString()) as RulesSnapshot;
  const changed = scheduleRules(store.rules()) !== scheduleRules(next);
  store.saveRules(next);
  if (changed) schedulePublish();
  res.end('ok');
});
route('GET', '/api/library', (_r, res) => {
  const lib = store.library();
  if (!lib) { json(res, {}, 404); return; }
  json(res, { ...lib, library: composed(lib.library) });
});
route('PUT', '/api/library', async (req, res) => {
  store.saveLibrary(JSON.parse((await body(req)).toString()) as LibraryFile);
  schedulePublish();
  res.end('ok');
});
route('GET', '/api/settings', (_r, res) => json(res, store.settings()));
route('PUT', '/api/settings', async (req, res) => { store.saveSettings(JSON.parse((await body(req)).toString()) as Settings); restartTimer(); res.end('ok'); });
route('GET', '/api/health', (_r, res) => json(res, { ok: true, dataDir: DATA, scan: scanStatus(), lastPublish: lastPublish() ?? null, nextPublishAt: nextPublishAt ?? null }));

// ---- probe files from another machine: scripts/probe-library.sh -u http://this-host:8787/imports/upload
route('PUT', '/imports/upload/:name', async (req, res, p) => {
  const base = path.basename(decodeURIComponent(p.name!));
  const raw = await body(req);
  const text = base.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const parsed = parseProbeJsonl(text);
  if (parsed.records.length === 0) { res.writeHead(400); res.end(`no records in ${base}\n`); return; }
  fs.mkdirSync(IMPORTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const dest = path.join(IMPORTS, base.replace(/(\.jsonl|\.json)(\.gz)?$/, `-${stamp}$1$2`));
  fs.writeFileSync(dest, raw);
  const result = importProbeLibrary(parsed.records);
  store.saveLibrary({ library: result.library, source: `probe from ${parsed.header?.host ?? 'another machine'}, ${new Date().toLocaleString()}` });
  schedulePublish();
  res.end(`library built from ${parsed.records.length} files (${parsed.errors.length} unreadable), saved as ${path.basename(dest)}\n`);
});

// ---- scanning
route('POST', '/api/scan', async (req, res) => {
  const b = (await body(req)).toString();
  const settings = store.settings();
  const opts = b ? (JSON.parse(b) as Partial<Settings['library']>) : {};
  const roots = opts.roots ?? settings.library.roots;
  if (scanStatus().running) { json(res, { error: 'A scan is already running' }, 409); return; }
  if (roots.length === 0) { json(res, { error: 'No library folders set' }, 400); return; }
  json(res, { started: true });
  const result = await runScan(roots, opts.ffprobe ?? settings.library.ffprobe);
  if (result) {
    let library = result.library;
    if (opts.roots) {
      // A partial rescan: replace what lives under the chosen folders, keep everything else as it was.
      const prev = store.library()?.library;
      const under = (p: string) => opts.roots!.some((r) => p === r.path || p.startsWith(r.path.replace(/\/+$/, '') + '/'));
      const kept = prev?.items.filter((i) => !under(i.path)) ?? [];
      const items = [...kept, ...library.items];
      const showIds = new Set(items.map((i) => i.showId).filter(Boolean));
      const shows = [...library.shows, ...(prev?.shows ?? []).filter((s) => !library.shows.some((n) => n.id === s.id))].filter((s) => showIds.has(s.id));
      library = { shows, items };
    }
    store.saveLibrary({ library, source: `scan ${new Date().toLocaleString()}` });
    schedulePublish();
  }
});
route('GET', '/api/scan/status', (_r, res) => json(res, scanStatus()));

// ---- break points (docs/breaks.md)
route('GET', '/api/breaks', (_r, res) => { const lib = store.library()?.library; json(res, lib ? showFolders(lib) : []); });
route('GET', '/api/breaks/status', (_r, res) => json(res, breaksStatus()));
route('GET', '/api/breaks/show', (_r, res, _p, url) => json(res, loadShow(url.searchParams.get('folder') ?? '')));
route('PUT', '/api/breaks/show', async (req, res) => {
  const show = JSON.parse((await body(req)).toString()) as ShowBreaks;
  if (show.version !== 1 || !show.folder || typeof show.files !== 'object') { json(res, { error: 'Not a breaks file (expected version 1, folder, files)' }, 400); return; }
  saveShow(show);
  schedulePublish(); // decisions change what the engine cuts, so the timeline re-flows from the next break
  res.end('ok');
});
route('POST', '/api/breaks/plan', async (req, res) => {
  const { folder, settings, force } = JSON.parse((await body(req)).toString()) as { folder: string; settings?: Record<string, unknown>; force?: boolean };
  const lib = store.library()?.library; if (!lib) { json(res, { error: 'No library' }, 400); return; }
  json(res, analyzePlan(lib, folder, settings ?? {}, !!force));
});
route('POST', '/api/breaks/analyze', async (req, res) => {
  const { folder, settings, force } = JSON.parse((await body(req)).toString()) as { folder: string; settings?: Record<string, unknown>; force?: boolean };
  const lib = store.library()?.library; if (!lib) { json(res, { error: 'No library' }, 400); return; }
  if (breaksStatus().running) { json(res, { error: 'A break analysis is already running' }, 409); return; }
  const ffmpeg = store.settings().library.ffprobe.replace(/ffprobe(\S*)$/, 'ffmpeg$1');
  json(res, { started: true });
  analyzeShow(ffmpeg, lib, folder, settings ?? {}, !!force).catch((e) => console.error('[breaks] analyze failed', e));
});
route('POST', '/api/breaks/cancel', (_r, res) => { cancelAnalyze(); json(res, { ok: true }); });
route('POST', '/api/breaks/import-embedded', async (req, res) => {
  const { folder } = JSON.parse((await body(req)).toString()) as { folder: string };
  const lib = store.library()?.library; if (!lib) { json(res, { error: 'No library' }, 400); return; }
  const n = importEmbedded(lib, folder); if (n) schedulePublish();
  json(res, { imported: n });
});
route('POST', '/api/breaks/seed', async (req, res) => {
  const { cachePath } = JSON.parse((await body(req)).toString()) as { cachePath: string };
  const lib = store.library()?.library; if (!lib) { json(res, { error: 'No library' }, 400); return; }
  try { json(res, seedFromChapterizeCache(lib, cachePath)); } catch (e) { json(res, { error: (e as Error).message }, 400); }
});

// ---- publishing
let timer: ReturnType<typeof setInterval> | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;
let nextPublishAt: number | undefined;
function restartTimer() {
  if (timer) clearInterval(timer);
  const hours = Math.max(0.25, store.settings().next.refreshHours);
  timer = setInterval(() => { if (store.settings().next.outputDir) safePublish('timer'); }, hours * 3600 * 1000);
  nextPublishAt = Date.now() + hours * 3600 * 1000;
}
function safePublish(reason: string) {
  try {
    const r = publishNow();
    console.log(`[publish:${reason}] ${r.error ?? `${r.channels.length} channels -> ${r.outputDir}`}`);
    nextPublishAt = Date.now() + Math.max(0.25, store.settings().next.refreshHours) * 3600 * 1000;
  } catch (e) { console.error('[publish] failed', e); }
}
/** Rules changed: regenerate soon, once the burst of edits settles. Only when an output folder is set. */
function schedulePublish() {
  if (!store.settings().next.outputDir) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => safePublish('change'), 5000);
}
route('POST', '/api/publish', (_r, res) => { try { json(res, publishNow()); } catch (e) { json(res, { error: (e as Error).message }, 500); } });
route('GET', '/api/publish/status', (_r, res) => json(res, { last: lastPublish() ?? null, nextPublishAt: nextPublishAt ?? null }));
/** What was actually published: per-channel block timelines plus the checkpoints the next publish will continue from. */
route('GET', '/api/published', (_r, res) => {
  const last = lastPublish();
  const timelines: Record<string, unknown> = {};
  for (const c of store.rules()?.channels ?? []) { const t = store.timeline(c.id); if (t) timelines[c.id] = t; }
  json(res, { at: last?.at ?? null, checkpoints: store.checkpoints(), timelines });
});

// ---- restart a channel from a moment: forget its history and write it fresh from there
route('POST', '/api/channels/:id/restart', async (req, res, p) => {
  const { anchorMs } = JSON.parse((await body(req)).toString()) as { anchorMs: number };
  const rules = store.rules();
  const ch = rules?.channels.find((c) => c.id === p.id);
  if (!rules || !ch) { json(res, { error: 'No such channel' }, 404); return; }
  store.saveRules({ ...rules, channels: rules.channels.map((c) => (c.id === ch.id ? { ...c, anchorMs } : c)) });
  const checkpoints = store.checkpoints(); delete checkpoints[ch.id]; store.saveCheckpoints(checkpoints);
  store.deleteTimeline(ch.id);
  const out = store.settings().next.outputDir;
  if (out) fs.rmSync(path.join(path.resolve(out), 'channels', ch.id, 'playout'), { recursive: true, force: true });
  clearTimeout(debounce);
  safePublish('restart');
  json(res, { ok: true });
});

// ---- live breaks: Next asks for the next item while inside a dynamic placeholder
const livePlayed: Record<string, number> = {};
route('GET', '/dynamic/:channelId', (req, res, _p, url) => {
  const full = store.library()?.library; const rules = store.rules();
  if (!full || !rules) { res.writeHead(404); res.end(); return; }
  const lib = visibleLibrary(composed(full), rules.hiddenFolders ?? []);
  const now = Date.parse(String(req.headers['x-etv-now'] ?? '')) || Date.now();
  const until = Date.parse(String(req.headers['x-etv-until'] ?? '')) || now + 60000;
  const room = until - now;
  const pick = (poolId: string | null, fit: (i: MediaItem) => boolean) => {
    const pool = rules.pools.find((p) => p.id === poolId);
    if (!pool) return undefined;
    const items = poolItems(pool, lib).filter(fit);
    if (items.length === 0) return undefined;
    const fresh = items.filter((i) => now - (livePlayed[i.id] ?? -Infinity) >= (pool.noRepeatMs ?? 0));
    const cands = fresh.length ? fresh : items;
    return cands[rngFor(`live-${now}`).int(cands.length)];
  };
  let item = pick(url.searchParams.get('pool'), (i) => !i.trimmable && i.durationMs <= room && i.durationMs > 0);
  if (!item && room > 0) item = pick(url.searchParams.get('filler'), (i) => i.trimmable || i.durationMs <= room);
  if (!item) { res.writeHead(404); res.end(); return; }
  livePlayed[item.id] = now;
  const settings = store.settings();
  const map = (p: string) => { for (const r of settings.next.pathMap) if (r.from && p.startsWith(r.from)) return r.to + p.slice(r.from.length); return p; };
  const finish = Math.min(until, now + (item.durationMs || room));
  const out: PlayoutItem = { id: `live-${item.id}-${now}`, start: new Date(now).toISOString(), finish: new Date(finish).toISOString() };
  if (item.still) {
    const seconds = Math.max(1, Math.ceil((finish - now) / 1000));
    out.tracks = { video: { source: { source_type: 'local', path: map(item.path) } }, audio: { source: { source_type: 'lavfi', params: `anullsrc=channel_layout=stereo:sample_rate=48000:d=${seconds}` } } };
  } else out.source = { source_type: 'local', path: map(item.path) };
  json(res, out);
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.pattern.exec(url.pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => { params[k] = m[i + 1]!; });
    try { await r.handler(req, res, params, url); } catch (e) { console.error(e); if (!res.headersSent) json(res, { error: (e as Error).message }, 500); }
    return;
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  console.log(`mimicTV service on http://localhost:${PORT}  data: ${DATA}`);
  restartTimer();
});

// `vite-node --watch` re-runs this file on every change without tearing the old run down, so
// release the port and stop the old timers first or the new run dies with EADDRINUSE and the
// stale code keeps serving.
declare global { interface ImportMeta { hot?: { on(event: string, cb: () => void): void } } }
import.meta.hot?.on('vite:beforeFullReload', () => {
  if (timer) clearInterval(timer);
  clearTimeout(debounce);
  server.closeAllConnections();
  server.close();
});

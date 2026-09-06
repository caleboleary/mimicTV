/** Write Next's files from a publish plan: lineup.json, channel.json, playout files, XMLTV. */
import fs from 'node:fs';
import path from 'node:path';
import { planPublish, mergePlayout, mergeTimeline, blocksFromPlayout, compactBlocks, visibleLibrary, DAY, type Channel, type Library, type PlayoutFile, type Ruleset, type ScheduledBlock } from '@mimictv/core';
import { store, writeJsonAtomic, files as dataFiles, readJson, type Settings } from './store';
import { composed } from './breaks';

export interface PublishResult { at: number; channels: { id: string; name: string; files: string[]; boundary: number }[]; outputDir: string; error?: string }

/** Days of already-aired blocks kept in the timeline files, so the guide can look back a little. */
const TIMELINE_HISTORY_DAYS = 2;

const PLAYOUT_NAME = /^\d{8}T\d{6}\.\d{9}[+-]\d{4}_\d{8}T\d{6}\.\d{9}[+-]\d{4}\.json$/;

function pathMapper(map: Settings['next']['pathMap']): ((p: string) => string) | undefined {
  const rules = map.filter((m) => m.from);
  if (rules.length === 0) return undefined;
  return (p) => { for (const r of rules) if (p.startsWith(r.from)) return r.to + p.slice(r.from.length); return p; };
}

/** First publish since block timelines were introduced: rebuild what is already on disk so the guide has no hole before the boundary. */
function recoverTimeline(playoutDir: string, channel: Channel, boundary: number, library: Library, map: ((p: string) => string) | undefined): ScheduledBlock[] {
  const unmap = map ? (p: string) => library.items.find((i) => map(i.path) === p)?.path ?? p : undefined;
  const blocks: ScheduledBlock[] = [];
  if (!fs.existsSync(playoutDir)) return blocks;
  for (const name of fs.readdirSync(playoutDir).sort()) {
    if (!PLAYOUT_NAME.test(name)) continue;
    const file = readJson<PlayoutFile>(path.join(playoutDir, name));
    if (file) blocks.push(...blocksFromPlayout(file, library, { channel, boundaryMs: boundary, unmapPath: unmap }));
  }
  return blocks;
}

function channelJson(settings: Settings): unknown {
  const v = settings.next.video;
  return {
    playout: { folder: './playout' },
    ffmpeg: { ffmpeg_path: '', ffprobe_path: '', disabled_filters: [] },
    normalization: {
      audio: { format: 'aac', bitrate_kbps: 192, buffer_kbps: 384, channels: 2, sample_rate_hz: 48000, normalize_loudness: true, loudness: { integrated_target: -16, range_target: 11, true_peak: -1.5 } },
      video: { format: v.format, bit_depth: 8, width: v.width, height: v.height, bitrate_kbps: v.bitrateKbps, buffer_kbps: v.bitrateKbps * 2, accel: v.accel, tonemap_algorithm: 'linear', vaapi_device: '/dev/dri/renderD128', vaapi_driver: 'iHD' },
      subtitle: { mode: 'burn' },
    },
  };
}

export function publishNow(now = Date.now()): PublishResult {
  const settings = store.settings();
  const rules = store.rules();
  const raw = store.library();
  const lib = raw && { ...raw, library: composed(raw.library) };
  const out = settings.next.outputDir && path.resolve(settings.next.outputDir);
  if (!out) return { at: now, channels: [], outputDir: '', error: 'No output folder set' };
  if (!rules || !lib) return { at: now, channels: [], outputDir: out, error: 'No rules or library saved yet' };

  // Hidden folders never schedule; recovery below still reads the full library so old playouts resolve.
  const ruleset: Ruleset = { library: visibleLibrary(lib.library, rules.hiddenFolders ?? []), pools: rules.pools, clocks: rules.clocks };
  const channels: Channel[] = [...rules.channels].sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
  const checkpoints = store.checkpoints();
  const pathMap = pathMapper(settings.next.pathMap);
  const plans = planPublish(channels, ruleset, {
    now, horizonDays: settings.next.horizonDays, checkpoints,
    pathMap,
    dynamicBaseUrl: settings.next.resolverUrl || undefined,
  });

  fs.mkdirSync(path.join(out, 'xmltv'), { recursive: true });
  const result: PublishResult = { at: now, channels: [], outputDir: out };
  for (const plan of plans) {
    const dir = path.join(out, 'channels', plan.channel.id);
    const playoutDir = path.join(dir, 'playout');
    fs.mkdirSync(playoutDir, { recursive: true });
    writeJsonAtomic(path.join(dir, 'channel.json'), channelJson(settings));
    const written: string[] = [];
    for (const f of plan.files) {
      const target = path.join(playoutDir, f.name);
      const existing = readJson<PlayoutFile>(target);
      writeJsonAtomic(target, mergePlayout(existing, f.playout, plan.boundary));
      written.push(f.name);
    }
    // Tidy: drop our old playout files that ended more than a day ago.
    for (const name of fs.readdirSync(playoutDir)) {
      if (!PLAYOUT_NAME.test(name) || written.includes(name)) continue;
      const finish = name.split('_')[1]!.replace('.json', '');
      const y = +finish.slice(0, 4), mo = +finish.slice(4, 6) - 1, d = +finish.slice(6, 8);
      if (new Date(y, mo, d).getTime() < now - 24 * 3600 * 1000) fs.rmSync(path.join(playoutDir, name), { force: true });
    }
    writeJsonAtomic(path.join(out, 'xmltv', `${plan.channel.tvgId}.xml`), plan.xmltv);
    const existingTimeline = store.timeline(plan.channel.id) ?? compactBlocks(recoverTimeline(playoutDir, plan.channel, plan.boundary, lib.library, pathMap));
    store.saveTimeline(plan.channel.id, mergeTimeline(existingTimeline, compactBlocks(plan.blocks), plan.boundary, now - TIMELINE_HISTORY_DAYS * DAY));
    checkpoints[plan.channel.id] = plan.checkpoint;
    result.channels.push({ id: plan.channel.id, name: plan.channel.name, files: written, boundary: plan.boundary });
  }
  // Channels that no longer exist: drop their checkpoint, timeline, and (only if it looks like ours) the folder Next was reading.
  for (const id of Object.keys(checkpoints)) if (!channels.some((c) => c.id === id)) { delete checkpoints[id]; store.deleteTimeline(id); }
  const channelsDir = path.join(out, 'channels');
  if (fs.existsSync(channelsDir)) {
    for (const name of fs.readdirSync(channelsDir)) {
      const dir = path.join(channelsDir, name);
      if (channels.some((c) => c.id === name) || !fs.existsSync(path.join(dir, 'channel.json')) || !fs.existsSync(path.join(dir, 'playout'))) continue;
      const stray = fs.readdirSync(path.join(dir, 'playout')).filter((f) => !PLAYOUT_NAME.test(f));
      if (stray.length === 0) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  store.saveCheckpoints(checkpoints);

  const lineup = {
    server: { bind_address: '0.0.0.0', port: 8409 },
    output: { folder: './hls' },
    xmltv: { folder: './xmltv' },
    channels: channels.filter((c) => plans.some((p) => p.channel.id === c.id)).map((c) => ({ number: c.number, name: c.name, config: `./channels/${c.id}/channel.json`, tvg_id: c.tvgId, logo: c.logo || undefined, group: c.group || undefined })),
  };
  writeJsonAtomic(path.join(out, 'lineup.json'), lineup);
  writeJsonAtomic(dataFiles.publishLog, result);
  return result;
}

export const lastPublish = () => readJson<PublishResult>(dataFiles.publishLog);

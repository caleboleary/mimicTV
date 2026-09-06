/** JSON files under data/. Every write is atomic (temp file + rename). */
import fs from 'node:fs';
import path from 'node:path';
import type { Channel, Checkpoint, Clock, CompactBlock, Library, MediaKind, Pool } from '@mimictv/core';

export const ROOT = path.resolve(import.meta.dirname ?? process.cwd(), '../../..');
export const DATA = process.env.MIMICTV_DATA ? path.resolve(process.env.MIMICTV_DATA) : path.join(ROOT, 'data');
export const IMPORTS = path.join(DATA, 'imports');
/** One file per channel: the blocks behind the playout files, so the app can show what was actually published. */
export const TIMELINES = path.join(DATA, 'timeline');

export interface RulesSnapshot { pools: Pool[]; clocks: Clock[]; channels: Channel[]; hiddenFolders?: string[]; selectedChannelId?: string; previewDate?: string; librarySource?: string }
export interface LibraryFile { library: Library; source: string }
export interface Settings {
  library: { roots: { path: string; kind?: MediaKind }[]; ffprobe: string };
  next: {
    /** Folder mimicTV writes into: lineup.json, channels/<id>/channel.json + playout/, xmltv/. */
    outputDir: string;
    horizonDays: number;
    refreshHours: number;
    /** Rewrite library paths for the machine running Next. */
    pathMap: { from: string; to: string }[];
    /** URL Next can reach mimicTV on, for live breaks. Empty = write pre-picked ads. */
    resolverUrl: string;
    /** Next as reached from the user's network, e.g. http://192.168.1.10:8410: the M3U/XMLTV links and the in-app preview use it. */
    publicUrl: string;
    /** Per-channel normalization defaults written to channel.json. */
    video: { width: number; height: number; bitrateKbps: number; format: string; accel: string };
  };
}

export const DEFAULT_SETTINGS: Settings = {
  library: { roots: [], ffprobe: 'ffprobe' },
  next: { outputDir: '', horizonDays: 3, refreshHours: 6, pathMap: [], resolverUrl: '', publicUrl: '', video: { width: 1920, height: 1080, bitrateKbps: 4000, format: 'h264', accel: '' } },
};

export function readJson<T>(file: string): T | undefined {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return undefined; }
}

export function writeJsonAtomic(file: string, value: unknown, opts?: { minify?: boolean }): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, typeof value === 'string' ? value : opts?.minify ? JSON.stringify(value) : JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export const files = {
  rules: path.join(DATA, 'rules.json'),
  library: path.join(DATA, 'library.json'),
  settings: path.join(DATA, 'settings.json'),
  checkpoints: path.join(DATA, 'checkpoints.json'),
  publishLog: path.join(DATA, 'publish-log.json'),
};

export const store = {
  rules: () => readJson<RulesSnapshot>(files.rules),
  library: () => readJson<LibraryFile>(files.library),
  settings: (): Settings => {
    const s = readJson<Partial<Settings>>(files.settings);
    return { library: { ...DEFAULT_SETTINGS.library, ...s?.library }, next: { ...DEFAULT_SETTINGS.next, ...s?.next, video: { ...DEFAULT_SETTINGS.next.video, ...s?.next?.video } } };
  },
  checkpoints: () => readJson<Record<string, Checkpoint>>(files.checkpoints) ?? {},
  saveRules: (r: RulesSnapshot) => writeJsonAtomic(files.rules, r),
  saveLibrary: (l: LibraryFile) => writeJsonAtomic(files.library, l),
  saveSettings: (s: Settings) => writeJsonAtomic(files.settings, s),
  saveCheckpoints: (c: Record<string, Checkpoint>) => writeJsonAtomic(files.checkpoints, c),
  timeline: (channelId: string) => readJson<CompactBlock[]>(path.join(TIMELINES, `${channelId}.json`)),
  saveTimeline: (channelId: string, blocks: CompactBlock[]) => writeJsonAtomic(path.join(TIMELINES, `${channelId}.json`), blocks, { minify: true }),
  deleteTimeline: (channelId: string) => fs.rmSync(path.join(TIMELINES, `${channelId}.json`), { force: true }),
};

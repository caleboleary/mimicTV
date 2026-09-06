/** Walk library roots with ffprobe and build the library in-process. Same records the shell script makes. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { importProbeLibrary, type MediaKind, type ProbeRecord, type Library, type RootSummary } from '@mimictv/core';
import { IMPORTS, writeJsonAtomic } from './store';

const EXT = /\.(mkv|mp4|m4v|avi|mov|ts|m2ts|mpg|mpeg|webm|wmv|flv|png|jpg|jpeg)$/i;

export interface ScanStatus {
  running: boolean;
  startedAt?: number;
  finishedAt?: number;
  total: number;
  done: number;
  failed: number;
  current?: string;
  error?: string;
  roots?: RootSummary[];
  /** Name of the JSONL written under data/imports, so the shell-script flow and this one look alike. */
  file?: string;
}

const status: ScanStatus = { running: false, total: 0, done: 0, failed: 0 };
export const scanStatus = () => status;

function walk(root: string, out: string[]): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && EXT.test(e.name)) out.push(p);
  }
}

function probe(ffprobe: string, file: string): Promise<ProbeRecord['probe'] | undefined> {
  return new Promise((resolve) => {
    const [cmd, ...pre] = ffprobe.split(/\s+/);
    const child = spawn(cmd!, [...pre, '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', '--', file]);
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => resolve(undefined));
    child.on('close', () => { try { resolve(JSON.parse(out)); } catch { resolve(undefined); } });
  });
}

export async function runScan(roots: { path: string; kind?: MediaKind }[], ffprobe: string, concurrency = 4): Promise<{ library: Library; roots: RootSummary[] } | undefined> {
  if (status.running) return undefined;
  Object.assign(status, { running: true, startedAt: Date.now(), finishedAt: undefined, total: 0, done: 0, failed: 0, error: undefined, current: undefined });
  try {
    const jobs: { root: string; file: string }[] = [];
    for (const r of roots) {
      const abs = path.resolve(r.path);
      if (!fs.existsSync(abs)) { status.error = `Not a folder: ${abs}`; continue; }
      const files: string[] = [];
      walk(abs, files);
      files.sort();
      for (const f of files) jobs.push({ root: abs, file: f });
    }
    status.total = jobs.length;
    const records: ProbeRecord[] = [];
    let next = 0;
    const worker = async () => {
      for (;;) {
        const job = jobs[next++];
        if (!job) return;
        status.current = path.basename(job.file);
        const p = await probe(ffprobe, job.file);
        if (p) records.push({ root: job.root, probe: p });
        else { status.failed++; records.push({ root: job.root, error: 'ffprobe failed', filename: job.file }); }
        status.done++;
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    records.sort((a, b) => (a.probe?.format?.filename ?? a.filename ?? '').localeCompare(b.probe?.format?.filename ?? b.filename ?? ''));

    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    const name = `scan-${stamp}.jsonl`;
    const header = { mimictv_probe: 1, generated_at: new Date().toISOString(), host: 'mimictv-server', roots: roots.map((r) => path.resolve(r.path)) };
    writeJsonAtomic(path.join(IMPORTS, name), [JSON.stringify(header), ...records.map((r) => JSON.stringify(r))].join('\n') + '\n');
    status.file = name;

    const rootKinds: Record<string, MediaKind> = {};
    for (const r of roots) if (r.kind) rootKinds[path.resolve(r.path)] = r.kind;
    const result = importProbeLibrary(records, { rootKinds });
    status.roots = result.roots;
    return result;
  } catch (e) {
    status.error = (e as Error).message;
    return undefined;
  } finally {
    status.running = false;
    status.finishedAt = Date.now();
    status.current = undefined;
  }
}

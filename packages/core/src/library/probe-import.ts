// Turns the JSONL written by scripts/probe-library.sh into a Library.
import type { Library, MediaItem, MediaKind, Show } from '../types';

export interface ProbeStream {
  index: number;
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  channels?: number;
  r_frame_rate?: string;
  tags?: Record<string, string>;
}
export interface ProbeChapter { start_time: string; end_time: string; tags?: Record<string, string> }
export interface ProbeFormat { filename: string; duration?: string; size?: string; format_name?: string; tags?: Record<string, string> }
export interface ProbeRecord {
  root: string;
  probe?: { format?: ProbeFormat; streams?: ProbeStream[]; chapters?: ProbeChapter[] };
  error?: string;
  filename?: string;
}
export interface ProbeHeader { mimictv_probe: number; generated_at: string; host: string; roots: string[] }

export function parseProbeJsonl(text: string): { header?: ProbeHeader; records: ProbeRecord[]; errors: string[] } {
  const records: ProbeRecord[] = [];
  const errors: string[] = [];
  let header: ProbeHeader | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let obj: unknown;
    try { obj = JSON.parse(line); } catch { errors.push(`unparseable line: ${line.slice(0, 80)}`); continue; }
    if (typeof obj !== 'object' || obj === null) continue;
    if ('mimictv_probe' in obj) { header = obj as ProbeHeader; continue; }
    const rec = obj as ProbeRecord;
    if (rec.error) { errors.push(`${rec.filename ?? '?'}: ${rec.error}`); continue; }
    if (rec.probe?.format?.filename) records.push(rec);
  }
  return { header, records, errors };
}

const KIND_KEYWORDS: [RegExp, MediaKind][] = [
  [/commercial|advert|\bads?\b/i, 'commercial'],
  [/bumper|bump\b/i, 'bumper'],
  [/\bids?\b|ident|station/i, 'network-id'],
  [/filler|static|interstitial|glitch|test.?card/i, 'filler'],
  [/movie|film/i, 'movie'],
  [/\btv\b|show|series|episode|anime|cartoon/i, 'episode'],
];

const SXXEYY = /\bS(\d{1,2})\s*E(\d{1,3})\b/i;
const NXM = /\b(\d{1,2})x(\d{1,3})\b/i;
const DOTTED = /\bs(\d{1,2})e(\d{1,3})\b/i;
/** Bare 3-digit codes like "501" (season 5, episode 1); never 4 digits (years) or things like 480p. */
const THREE_DIGIT = /(?<![\dA-Za-z])(\d)(\d{2})(?![\dpPxXkK])/;

function basename(p: string): string { return p.split('/').filter(Boolean).pop() ?? p; }
function stripExt(p: string): string { return p.replace(/\.[a-z0-9]{2,5}$/i, ''); }
export function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function relSegments(root: string, path: string): string[] {
  const r = root.replace(/\/+$/, '');
  const rel = path.startsWith(r + '/') ? path.slice(r.length + 1) : path;
  return rel.split('/').filter(Boolean);
}

export function parseEpisode(name: string): { season: number; episode: number; rest: string } | undefined {
  for (const re of [SXXEYY, NXM, DOTTED, THREE_DIGIT]) {
    const m = re.exec(name);
    if (m) return { season: Number(m[1]), episode: Number(m[2]), rest: name.slice(m.index + m[0].length) };
  }
  return undefined;
}

/** Turn a release-style folder name into a clean show title and year.
 *  "SpongeBob SquarePants (1999) S01-S15 720p AMZN x264-GROUP" -> { title: "SpongeBob SquarePants", year: 1999 } */
export function parseShowFolder(folder: string): { title: string; year: number } {
  if (!/\s/.test(folder) && (folder.match(/\./g) ?? []).length >= 2) folder = folder.replace(/\./g, ' ');
  folder = folder.replace(/^\[[^\]]*\]\s*/, '');
  const yearMatch = /\b(19\d{2}|20\d{2})\b/.exec(folder);
  const year = yearMatch ? Number(yearMatch[1]) : 0;
  const cutters = [
    /\s*[\(\[]\s*(19|20)\d{2}/, /\s+(19|20)\d{2}\b/, /\s+\(?S\d{1,2}\b/i, /\s+\(?Seasons?\b/i, /\s+-\s+Complete\b/i, /\s+Complete\b/i,
    /\s+\d{3,4}p\b/i, /\s+x26[45]\b/i, /\s+(?:HEVC|AVC|WEB-?DL|BluRay|DVDRip|HDTV|AMZN|HMAX|NF)\b/i, /\s*\[/, /\s+-\s+/,
  ];
  let title = folder;
  for (const re of cutters) {
    const m = re.exec(title);
    if (m && m.index > 0) title = title.slice(0, m.index);
  }
  title = title.replace(/[\s\-_.,]+$/, '').replace(/[._]+/g, ' ').trim();
  if (!title) title = folder;
  return { title, year };
}

/** Strip quality/source tags from an episode title: "The Switching Hour (480p - DVDRip)" -> "The Switching Hour" */
export function cleanEpisodeTitle(t: string): string {
  if (!/\s/.test(t) && (t.match(/\./g) ?? []).length >= 2) t = t.replace(/\./g, ' ');
  return t
    .replace(/^-?\s*E\d{1,3}\s*[-–]\s*/i, '')
    .replace(/[\(\[][^\)\]]*(?:\d{3,4}p|rip|web|dl|x26[45]|hevc|bluray|hdtv|aac|ac3|dd[p+]?\d|h\.?264|10bit)[^\)\]]*[\)\]]/gi, '')
    .replace(/\b\d{3,4}p\b.*$/i, '')
    .replace(/[\s\-_.]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function guessKind(root: string, path: string, durationMs: number): MediaKind {
  const segs = relSegments(root, path);
  const candidates = [basename(root), ...segs.slice(0, -1)];
  for (const c of candidates) for (const [re, kind] of KIND_KEYWORDS) if (re.test(c)) return kind;
  if (parseEpisode(basename(path))) return 'episode';
  if (durationMs >= 40 * 60 * 1000) return 'movie';
  if (durationMs > 0 && durationMs <= 2 * 60 * 1000) return 'commercial';
  return 'filler';
}

export interface RootSummary {
  root: string;
  kind: MediaKind;
  count: number;
  durationMs: number;
  episodes: number;
  withChapters: number;
  shows: number;
}

export interface ImportOptions {
  /** Override the guessed kind per root folder. */
  rootKinds?: Record<string, MediaKind>;
}

export function importProbeLibrary(records: ProbeRecord[], opts: ImportOptions = {}): { library: Library; roots: RootSummary[] } {
  const items: MediaItem[] = [];
  const shows = new Map<string, Show>();
  const roots = new Map<string, RootSummary>();
  const seenIds = new Set<string>();
  // Per-folder counters for episodes whose filenames carry no episode number.
  const folderCounters = new Map<string, number>();

  const sorted = [...records].sort((a, b) => a.probe!.format!.filename.localeCompare(b.probe!.format!.filename));

  for (const rec of sorted) {
    const fmt = rec.probe!.format!;
    const path = fmt.filename;
    const streams = rec.probe!.streams ?? [];
    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.find((s) => s.codec_type === 'audio');
    const isImage = !!video && /^(png|mjpeg|bmp|gif|webp|tiff)$/i.test(video.codec_name ?? '') && !audio;
    const durationMs = isImage ? 0 : Math.round(Number(fmt.duration ?? 0) * 1000);
    const rootKind = opts.rootKinds?.[rec.root];
    const kind: MediaKind = rootKind ?? guessKind(rec.root, path, durationMs);
    // Images only make sense as filler stills; in a TV or movie root they're thumbnails and posters.
    if (isImage && kind !== 'filler') continue;
    if (!isImage && durationMs <= 0) continue;

    const segs = relSegments(rec.root, path);
    const fileName = stripExt(basename(path));
    const rootTag = slug(basename(rec.root));
    const tags = [kind, rootTag, ...segs.slice(0, -1).filter((s) => s !== segs[0] || kind !== 'episode').map(slug)].filter((t, i, a) => t && a.indexOf(t) === i);

    let idBase = slug(segs.join('-')) || slug(fileName);
    let id = idBase;
    for (let n = 2; seenIds.has(id); n++) id = `${idBase}-${n}`;
    seenIds.add(id);

    const chapters = (rec.probe!.chapters ?? [])
      .map((c) => Math.round(Number(c.start_time) * 1000))
      .filter((ms) => ms > 1000 && ms < durationMs - 1000)
      .sort((a, b) => a - b);

    const item: MediaItem = {
      id, kind, title: fileName, path, durationMs, tags,
      breakPoints: chapters,
      breakSource: chapters.length > 0 ? 'chapters' : 'none',
      media: {
        container: fmt.format_name, videoCodec: video?.codec_name, width: video?.width, height: video?.height,
        frameRate: video?.r_frame_rate, audioCodec: audio?.codec_name, audioChannels: audio?.channels,
        hasSubtitles: streams.some((s) => s.codec_type === 'subtitle'),
        sizeBytes: fmt.size ? Number(fmt.size) : undefined,
      },
    };
    if (isImage) { item.still = true; item.trimmable = true; }
    else if (kind === 'filler') item.trimmable = true;

    if (kind === 'episode') {
      const showFolder = segs.length >= 2 ? segs[0]! : basename(rec.root);
      const parsedShow = parseShowFolder(showFolder);
      const showId = slug(parsedShow.year ? `${parsedShow.title} ${parsedShow.year}` : parsedShow.title);
      if (!shows.has(showId)) shows.set(showId, { id: showId, title: parsedShow.title, year: parsedShow.year, tags: [rootTag] });
      const ep = parseEpisode(fileName);
      const seasonFolder = segs.length >= 3 ? /(?:season|series|s)\s*0*(\d+)/i.exec(segs[1]!) : null;
      const folderKey = segs.slice(0, -1).join('/');
      let season = ep?.season ?? (seasonFolder ? Number(seasonFolder[1]) : 1);
      let episode = ep?.episode;
      if (episode == null) {
        const n = (folderCounters.get(folderKey) ?? 0) + 1;
        folderCounters.set(folderKey, n);
        episode = n;
      }
      item.showId = showId; item.season = season; item.episode = episode;
      if (!ep) item.tags.push('unnumbered');
      if (season === 0) item.tags.push('special');
      if (segs.slice(0, -1).some((seg) => /^(extras?|specials?|featurettes?|bonus|behind the scenes|shorts?|promos?)$/i.test(seg))) item.tags.push('extra');
      const rest = cleanEpisodeTitle(ep?.rest.replace(/^[\s\-–.]+/, '') ?? '').replace(/(?<=\w)\.(?=\w)/g, ' ');
      const tagTitle = fmt.tags?.title && !/s\d+\s*e\d+|\d+x\d+|\.(mkv|mp4|avi)$/i.test(fmt.tags.title) ? cleanEpisodeTitle(fmt.tags.title) : '';
      item.title = rest || tagTitle || `Episode ${episode}`;
    } else if (kind === 'movie') {
      const m = /^(.*?)\s*\((\d{4})\)\s*$/.exec(fileName);
      item.title = m ? m[1]! : fileName;
      if (m) item.tags.push(m[2]!);
    } else {
      item.title = fmt.tags?.title || fileName.replace(/[._]+/g, ' ');
    }
    items.push(item);

    const rs = roots.get(rec.root) ?? { root: rec.root, kind, count: 0, durationMs: 0, episodes: 0, withChapters: 0, shows: 0 };
    rs.count++; rs.durationMs += durationMs;
    if (kind === 'episode') { rs.episodes++; if (chapters.length > 0) rs.withChapters++; }
    roots.set(rec.root, rs);
  }

  for (const rs of roots.values()) {
    rs.shows = new Set(items.filter((i) => i.path.startsWith(rs.root) && i.showId).map((i) => i.showId)).size;
  }

  return { library: { shows: [...shows.values()].sort((a, b) => a.title.localeCompare(b.title)), items }, roots: [...roots.values()] };
}

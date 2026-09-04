// Emits the per-channel XMLTV file Next copies <programme> elements from.
import type { Channel, Library, ScheduledBlock } from '../types';
import { toXmltvTime } from '../time';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface Programme {
  start: number;
  stop: number;
  title: string;
  subTitle?: string;
  season?: number;
  episode?: number;
  category?: string;
  desc?: string;
}

export function programmesFor(blocks: ScheduledBlock[], library: Library): Programme[] {
  const shows = new Map(library.shows.map((s) => [s.id, s]));
  const out: Programme[] = [];
  for (const block of blocks) {
    // Each program in a block becomes one programme spanning from its first part to the next program.
    const firsts = block.entries.filter((e) => e.role === 'program' && e.partIndex === 0);
    firsts.forEach((e, i) => {
      const next = firsts[i + 1];
      const show = e.item.showId ? shows.get(e.item.showId) : undefined;
      out.push({
        start: e.start,
        stop: next ? next.start : block.end,
        title: show?.title ?? e.item.title,
        subTitle: show ? e.item.title : undefined,
        season: e.item.season,
        episode: e.item.episode,
        category: e.item.tags.find((t) => ['sitcom', 'cartoon', 'drama', 'movie'].includes(t)),
        desc: show ? `${show.title} (${show.year})` : undefined,
      });
    });
    if (firsts.length === 0) {
      out.push({ start: block.start, stop: block.end, title: 'Station Break' });
    }
  }
  return out;
}

export function toXmltv(channel: Channel, programmes: Programme[]): string {
  const lines: string[] = ['<?xml version="1.0" encoding="utf-8"?>', '<tv generator-info-name="mimicTV">'];
  lines.push(`  <channel id="${esc(channel.tvgId)}">`);
  lines.push(`    <display-name>${esc(channel.name)}</display-name>`);
  if (channel.logo) lines.push(`    <icon src="${esc(channel.logo)}" />`);
  lines.push('  </channel>');
  for (const p of programmes) {
    lines.push(`  <programme start="${toXmltvTime(p.start)}" stop="${toXmltvTime(p.stop)}" channel="${esc(channel.tvgId)}">`);
    lines.push(`    <title lang="en">${esc(p.title)}</title>`);
    if (p.subTitle) lines.push(`    <sub-title lang="en">${esc(p.subTitle)}</sub-title>`);
    if (p.desc) lines.push(`    <desc lang="en">${esc(p.desc)}</desc>`);
    if (p.category) lines.push(`    <category lang="en">${esc(p.category)}</category>`);
    if (p.season != null && p.episode != null) {
      lines.push(`    <episode-num system="xmltv_ns">${p.season - 1}.${p.episode - 1}.</episode-num>`);
      lines.push(`    <episode-num system="onscreen">S${String(p.season).padStart(2, '0')}E${String(p.episode).padStart(2, '0')}</episode-num>`);
    }
    lines.push('  </programme>');
  }
  lines.push('</tv>', '');
  return lines.join('\n');
}

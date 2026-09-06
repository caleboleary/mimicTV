import { fmtClockSec, fmtDuration, type Clock, type ScheduledBlock, type TimelineEntry } from '@mimictv/core';
import { useStore } from '../store/store';
import { entryColor } from '../colors';

const epCode = (e: TimelineEntry) => (e.item.season != null ? `S${String(e.item.season).padStart(2, '0')}E${String(e.item.episode).padStart(2, '0')}` : undefined);

/**
 * One block, programmes first: each programme part is a card, and every break is a compact
 * group of one-line rows, so a half hour with a dozen ads still reads as "a show with breaks".
 */
export default function BlockDetail({ block, clock }: { block: ScheduledBlock; clock?: Clock }) {
  const shows = useStore((s) => s.library.shows);
  const showTitle = (id?: string) => shows.find((s) => s.id === id)?.title;
  const programs = block.entries.filter((e) => e.role === 'program');
  const breakLens = block.breaks.map((b) => b.end - b.start);
  const spread = breakLens.length > 1 ? Math.max(...breakLens) - Math.min(...breakLens) : 0;

  // Group consecutive break entries so they render as one unit.
  type Item = { kind: 'program'; e: TimelineEntry } | { kind: 'break'; index?: number; entries: TimelineEntry[] };
  const items: Item[] = [];
  for (const e of block.entries) {
    const last = items[items.length - 1];
    if (e.role === 'program') items.push({ kind: 'program', e });
    else if (last?.kind === 'break') last.entries.push(e);
    else items.push({ kind: 'break', index: e.breakIndex, entries: [e] });
  }

  return (
    <div className="panel">
      <h3>{clock?.name ?? block.clockId}</h3>
      <div className="mono" style={{ fontSize: 15, margin: '4px 0 10px' }}>
        {fmtClockSec(block.start)} – {fmtClockSec(block.end)}
      </div>
      <div className="stats" style={{ marginBottom: 12 }}>
        <div className="stat"><b>{fmtDuration(block.contentMs)}</b><span>content</span></div>
        <div className="stat"><b>{fmtDuration(block.breakBudgetMs)}</b><span>breaks</span></div>
        <div className="stat"><b>{block.breaks.length}</b><span>{spread <= 200 ? 'equal' : `±${fmtDuration(spread)}`}</span></div>
      </div>

      <div className="entries">
        {items.map((it, i) => {
          if (it.kind === 'program') {
            const { e } = it;
            const show = showTitle(e.item.showId);
            return (
              <div key={e.id} className="prog" style={{ borderLeftColor: entryColor(e.item, e.role) }}>
                <div className="prog-head">
                  <b>{show ?? e.item.title}</b>
                  {e.partCount && e.partCount > 1 && <span className="badge">part {e.partIndex! + 1}/{e.partCount}</span>}
                  <span className="mono muted">{fmtClockSec(e.start)} · {fmtDuration(e.end - e.start)}</span>
                </div>
                {show && <div className="prog-sub">{[epCode(e), e.item.title].filter(Boolean).join(' · ')}</div>}
                {e.partIndex === 0 && <div className="why">{e.reason}</div>}
              </div>
            );
          }
          const brk = it.index != null ? block.breaks.find((b) => b.index === it.index) : undefined;
          const len = it.entries[it.entries.length - 1]!.end - it.entries[0]!.start;
          const ads = it.entries.filter((e) => e.role === 'commercial').length;
          return (
            <div key={`brk-${i}`} className={`brk-group ${brk?.kind ?? ''}`}>
              <div className="brk-head">
                {brk ? (brk.kind === 'post' ? 'Post-roll' : `Break ${brk.index + 1}`) : 'Break'} · {fmtDuration(len)} · {it.entries.length} item{it.entries.length === 1 ? '' : 's'}{ads && ads !== it.entries.length ? ` (${ads} ads)` : ''}
                {brk?.nearBoundary ? ' · near :00/:30' : ''}
              </div>
              {it.entries.map((e) => (
                <div key={e.id} className="ad" title={e.reason}>
                  <span className="t">{fmtClockSec(e.start)}</span>
                  <span className="sw" style={{ background: entryColor(e.item, e.role) }} />
                  <span className="n">{e.item.title}{e.role !== 'commercial' && <em> {e.role}</em>}</span>
                  <span className="d">{fmtDuration(e.end - e.start)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {programs.some((p) => p.partCount === 1 && p.item.kind === 'episode') && (
        <div className="small" style={{ marginTop: 10, color: 'var(--warn)' }}>
          An episode here has no break points, so the whole pad landed in the post-roll.
        </div>
      )}
    </div>
  );
}

import { fmtClockSec, fmtDuration, type Clock, type ScheduledBlock } from '@mimictv/core';
import { entryColor } from '../colors';

export default function BlockDetail({ block, clock }: { block: ScheduledBlock; clock?: Clock }) {
  const programs = block.entries.filter((e) => e.role === 'program');
  const breakLens = block.breaks.map((b) => b.end - b.start);
  const spread = breakLens.length > 1 ? Math.max(...breakLens) - Math.min(...breakLens) : 0;
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
        {block.entries.map((e, i) => {
          const prev = block.entries[i - 1];
          const startsBreak = e.role !== 'program' && (!prev || prev.role === 'program');
          const brk = startsBreak ? block.breaks.find((b) => b.index === e.breakIndex) : undefined;
          return (
            <div key={e.id}>
              {brk && (
                <div className={`break-head ${brk.kind}`}>
                  {brk.kind === 'post' ? 'Post-roll' : `Break ${brk.index + 1}`} · {fmtDuration(brk.end - brk.start)}
                  {brk.nearBoundary ? ' · near :00/:30' : ''}
                </div>
              )}
              <div className="entry">
                <span className="t">{fmtClockSec(e.start)}</span>
                <span className="sw" style={{ background: entryColor(e.item, e.role) }} />
                <span>
                  {e.item.title}
                  {e.role === 'program' && e.item.season != null && (
                    <span className="muted"> S{String(e.item.season).padStart(2, '0')}E{String(e.item.episode).padStart(2, '0')}
                      {e.partCount && e.partCount > 1 ? ` · part ${e.partIndex! + 1}/${e.partCount}` : ''}
                    </span>
                  )}
                </span>
                <span className="d">{fmtDuration(e.end - e.start)}</span>
                <span className="why">{e.reason}</span>
              </div>
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

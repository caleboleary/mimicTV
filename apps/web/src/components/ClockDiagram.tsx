import { fmtDuration, type ScheduledBlock } from '@mimictv/core';
import { entryColor } from '../colors';

/** A format-clock style bar for one real block produced by a clock. */
export default function ClockDiagram({ block }: { block: ScheduledBlock }) {
  const total = block.end - block.start;
  return (
    <div>
      <div className="clockbar">
        {block.entries.map((e) => {
          const left = ((e.start - block.start) / total) * 100;
          const width = ((e.end - e.start) / total) * 100;
          const label = e.role === 'program' ? fmtDuration(e.end - e.start) : '';
          return (
            <div key={e.id} className={`seg ${e.role}`} title={`${e.item.title} · ${fmtDuration(e.end - e.start)}`}
              style={{ left: `${left}%`, width: `${width}%`, background: e.role === 'program' ? entryColor(e.item, e.role) : undefined }}>
              {width > 8 ? label : ''}
            </div>
          );
        })}
      </div>
      <div className="clock-ruler">
        <span>:00</span>
        <span>{fmtDuration(total / 2)}</span>
        <span>{fmtDuration(total)}</span>
      </div>
    </div>
  );
}

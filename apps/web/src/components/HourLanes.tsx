import { HOUR, MIN, type ScheduledBlock, type TimelineEntry } from '@mimictv/core';
import { entryColor } from '../colors';

interface Props {
  dayStart: number;
  blocks: ScheduledBlock[];
  selectedBlockId?: string;
  onSelect?: (block: ScheduledBlock, entry: TimelineEntry) => void;
  compact?: boolean;
  hours?: number;
  /** Wall-clock now; draws a live marker in the lane that contains it. */
  nowMs?: number;
}

export default function HourLanes({ dayStart, blocks, selectedBlockId, onSelect, compact, hours = 24, nowMs }: Props) {
  const lanes = Array.from({ length: hours }, (_, h) => dayStart + h * HOUR);
  return (
    <div className={`lanes${compact ? ' compact' : ''}`}>
      {lanes.map((laneStart) => {
        const laneEnd = laneStart + HOUR;
        const d = new Date(laneStart);
        return (
          <div className="lane" key={laneStart}>
            <div className="label">{String(d.getHours()).padStart(2, '0')}:00</div>
            <div className="bar">
              {[15, 30, 45].map((m) => <span className="tick" key={m} style={{ left: `${(m / 60) * 100}%` }} />)}
              {blocks.filter((b) => b.end > laneStart && b.start < laneEnd).flatMap((b) =>
                b.entries.filter((e) => e.end > laneStart && e.start < laneEnd).map((e) => {
                  const s = Math.max(e.start, laneStart);
                  const f = Math.min(e.end, laneEnd);
                  const left = ((s - laneStart) / HOUR) * 100;
                  const width = ((f - s) / HOUR) * 100;
                  const dim = selectedBlockId != null && selectedBlockId !== b.id;
                  const label = e.role === 'program' && f - s > 4 * MIN
                    ? `${e.item.showId ? showTitle(e) : e.item.title}${e.partCount && e.partCount > 1 ? ` · ${e.partIndex! + 1}/${e.partCount}` : ''}`
                    : '';
                  return (
                    <div
                      key={e.id + laneStart}
                      className={`seg ${e.role}${dim ? ' dim' : ''}${selectedBlockId === b.id && !compact ? ' sel' : ''}`}
                      style={{ left: `${left}%`, width: `${width}%`, background: e.role === 'program' ? entryColor(e.item, e.role) : undefined }}
                      title={`${e.item.title} (${e.role})`}
                      onClick={() => onSelect?.(b, e)}
                    >
                      {compact ? null : label}
                    </div>
                  );
                }),
              )}
              {nowMs != null && nowMs >= laneStart && nowMs < laneEnd && <div className="nowline" style={{ left: `${((nowMs - laneStart) / HOUR) * 100}%` }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function showTitle(e: TimelineEntry): string {
  // Show id is kebab-case; the store has the pretty title but the lane only needs something readable.
  return e.item.showId!.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
}

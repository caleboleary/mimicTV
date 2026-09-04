import { DAY, type ScheduledBlock } from '@mimictv/core';
import { entryColor } from '../colors';

/** One 24-hour strip on a single line, for channel cards. */
export default function DayStrip({ dayStart, blocks }: { dayStart: number; blocks: ScheduledBlock[] }) {
  const end = dayStart + DAY;
  return (
    <div className="strip">
      {blocks.flatMap((b) => b.entries.filter((e) => e.role === 'program' && e.end > dayStart && e.start < end).map((e) => {
        const s = Math.max(e.start, dayStart), f = Math.min(e.end, end);
        return <div key={e.id} className="seg program" title={e.item.title} style={{ left: `${((s - dayStart) / DAY) * 100}%`, width: `${((f - s) / DAY) * 100}%`, background: entryColor(e.item, e.role) }} />;
      }))}
    </div>
  );
}

import { useMemo } from 'react';
import { blocksInWindow, fmtDuration, DAY, type Channel, type ScheduledBlock, type Simulation } from '@mimictv/core';
import { useStore, dateStart, isoDate } from '../store/store';
import HourLanes from './HourLanes';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function DateBar({ onChange }: { onChange?: () => void }) {
  const previewDate = useStore((s) => s.previewDate);
  const setPreviewDate = useStore((s) => s.setPreviewDate);
  const dayStart = dateStart(previewDate);
  const weekStart = dayStart - new Date(dayStart).getDay() * DAY;
  const week = Array.from({ length: 7 }, (_, i) => weekStart + i * DAY);
  const go = (iso: string) => { onChange?.(); setPreviewDate(iso); };
  return (
    <>
      <button className="btn sm" onClick={() => go(isoDate(dayStart - DAY))}>◀</button>
      <div className="chips">
        {week.map((d) => (
          <button key={d} className={`chip${isoDate(d) === previewDate ? ' on' : ''}`} onClick={() => go(isoDate(d))}>
            {WEEKDAYS[new Date(d).getDay()]} {new Date(d).getDate()}
          </button>
        ))}
      </div>
      <button className="btn sm" onClick={() => go(isoDate(dayStart + DAY))}>▶</button>
      <input type="date" value={previewDate} onChange={(e) => { if (e.target.value) go(e.target.value); }} />
    </>
  );
}

interface Props {
  channel: Channel;
  sim: Simulation | undefined;
  selectedBlockId?: string;
  onSelect: (b: ScheduledBlock) => void;
}

export default function DayPreview({ channel, sim, selectedBlockId, onSelect }: Props) {
  const previewDate = useStore((s) => s.previewDate);
  const dayStart = dateStart(previewDate), dayEnd = dayStart + DAY;
  const blocks = useMemo(() => (sim ? blocksInWindow(sim, dayStart, dayEnd) : []), [sim, dayStart, dayEnd]);
  const totals = useMemo(() => {
    const t = { program: 0, commercial: 0, filler: 0, ids: 0 };
    for (const b of blocks) for (const e of b.entries) {
      const s = Math.max(e.start, dayStart), f = Math.min(e.end, dayEnd);
      if (f <= s) continue;
      if (e.role === 'program') t.program += f - s; else if (e.role === 'commercial') t.commercial += f - s; else if (e.role === 'filler') t.filler += f - s; else t.ids++;
    }
    return t;
  }, [blocks, dayStart, dayEnd]);
  const covered = totals.program + totals.commercial + totals.filler || 1;
  return (
    <div className="panel">
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <h2>{new Date(dayStart).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
        <div className="grow" />
        <div className="stats">
          <div className="stat"><b>{blocks.length}</b><span>blocks</span></div>
          <div className="stat"><b>{Math.round((totals.program / covered) * 100)}%</b><span>content</span></div>
          <div className="stat"><b>{Math.round((totals.commercial / covered) * 100)}%</b><span>ads</span></div>
          <div className="stat"><b>{fmtDuration(totals.filler)}</b><span>filler</span></div>
          <div className="stat"><b>{totals.ids}</b><span>IDs</span></div>
        </div>
      </div>
      {!sim ? (
        <div className="empty">This channel has no format yet.</div>
      ) : blocks.length === 0 ? (
        <div className="empty">Nothing scheduled: this channel's timeline starts {new Date(channel.anchorMs).toLocaleString()}.</div>
      ) : (
        <HourLanes dayStart={dayStart} blocks={blocks} selectedBlockId={selectedBlockId} onSelect={onSelect} />
      )}
      <div className="legend" style={{ marginTop: 12 }}>
        <span><i style={{ background: 'hsl(200 55% 52%)' }} />program (color = show)</span>
        <span><i style={{ background: 'var(--ad)' }} />commercial</span>
        <span><i style={{ background: 'var(--accent)' }} />network ID</span>
        <span><i style={{ background: 'var(--filler)' }} />filler / pad</span>
        <span className="muted">· click a block to inspect</span>
      </div>
    </div>
  );
}

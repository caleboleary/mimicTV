import { useMemo, useState } from 'react';
import { blocksInWindow, fmtDuration, DAY, type ScheduledBlock } from '@mimictv/core';
import { useStore, dateStart, isoDate } from '../store/store';
import { useSelectedChannel, useSim } from '../store/useSim';
import HourLanes from '../components/HourLanes';
import BlockDetail from '../components/BlockDetail';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function PreviewPage() {
  const channels = useStore((s) => s.channels);
  const clocks = useStore((s) => s.clocks);
  const selectChannel = useStore((s) => s.selectChannel);
  const previewDate = useStore((s) => s.previewDate);
  const setPreviewDate = useStore((s) => s.setPreviewDate);
  const channel = useSelectedChannel();
  const sim = useSim(channel);
  const [selected, setSelected] = useState<string | undefined>();

  const dayStart = dateStart(previewDate);
  const dayEnd = dayStart + DAY;
  const blocks = useMemo(() => (sim ? blocksInWindow(sim, dayStart, dayEnd) : []), [sim, dayStart, dayEnd]);
  const selectedBlock = blocks.find((b) => b.id === selected);

  // Week chips around the preview date.
  const weekStart = dayStart - new Date(dayStart).getDay() * DAY;
  const week = Array.from({ length: 7 }, (_, i) => weekStart + i * DAY);

  const totals = useMemo(() => {
    const t = { program: 0, commercial: 0, filler: 0, ids: 0 };
    for (const b of blocks) for (const e of b.entries) {
      const s = Math.max(e.start, dayStart), f = Math.min(e.end, dayEnd);
      if (f <= s) continue;
      if (e.role === 'program') t.program += f - s;
      else if (e.role === 'commercial') t.commercial += f - s;
      else if (e.role === 'filler') t.filler += f - s;
      else t.ids += 1;
    }
    return t;
  }, [blocks, dayStart, dayEnd]);
  const covered = totals.program + totals.commercial + totals.filler || 1;

  const shift = (days: number) => { setSelected(undefined); setPreviewDate(isoDate(dayStart + days * DAY)); };
  const onSelect = (b: ScheduledBlock) => setSelected((cur) => (cur === b.id ? undefined : b.id));

  if (channels.length === 0) {
    return <div><div className="toolbar"><h1>Preview</h1></div><div className="panel empty">No channels yet. Build a pool, then a clock, then a channel, and the day shows up here.</div></div>;
  }

  return (
    <div>
      <div className="toolbar">
        <div className="tabs">
          {channels.map((c) => (
            <button key={c.id} className={c.id === channel?.id ? 'on' : ''} onClick={() => { setSelected(undefined); selectChannel(c.id); }}>
              <span className="mono muted">{c.number}</span> {c.name}
            </button>
          ))}
        </div>
        <div className="grow" />
        <button className="btn sm" onClick={() => shift(-1)}>◀</button>
        <div className="chips">
          {week.map((d) => (
            <button key={d} className={`chip${isoDate(d) === previewDate ? ' on' : ''}`} onClick={() => { setSelected(undefined); setPreviewDate(isoDate(d)); }}>
              {WEEKDAYS[new Date(d).getDay()]} {new Date(d).getDate()}
            </button>
          ))}
        </div>
        <button className="btn sm" onClick={() => shift(1)}>▶</button>
        <input type="date" value={previewDate} onChange={(e) => { if (e.target.value) { setSelected(undefined); setPreviewDate(e.target.value); } }} />
      </div>

      <div className="split">
        <div>
          <div className="panel">
            <div className="toolbar" style={{ marginBottom: 12 }}>
              <h1>{new Date(dayStart).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h1>
              <div className="grow" />
              <div className="stats">
                <div className="stat"><b>{blocks.length}</b><span>blocks</span></div>
                <div className="stat"><b>{Math.round((totals.program / covered) * 100)}%</b><span>content</span></div>
                <div className="stat"><b>{Math.round((totals.commercial / covered) * 100)}%</b><span>ads</span></div>
                <div className="stat"><b>{fmtDuration(totals.filler)}</b><span>filler</span></div>
                <div className="stat"><b>{totals.ids}</b><span>IDs</span></div>
              </div>
            </div>
            {blocks.length === 0 ? (
              <div className="empty">{!sim ? 'This channel has no clock assigned yet. Add a daypart on the Channels page.' : `Nothing scheduled: this channel's timeline starts ${channel ? new Date(channel.anchorMs).toLocaleString() : ''}.`}</div>
            ) : (
              <HourLanes dayStart={dayStart} blocks={blocks} selectedBlockId={selected} onSelect={onSelect} />
            )}
            <div className="legend" style={{ marginTop: 12 }}>
              <span><i style={{ background: 'hsl(200 55% 52%)' }} />program (color = show)</span>
              <span><i style={{ background: 'var(--ad)' }} />commercial</span>
              <span><i style={{ background: 'var(--accent)' }} />network ID</span>
              <span><i style={{ background: 'var(--filler)' }} />filler / pad</span>
              <span className="muted">· click a block to inspect it</span>
            </div>
          </div>
        </div>
        <div>
          {selectedBlock ? (
            <BlockDetail block={selectedBlock} clock={clocks.find((c) => c.id === selectedBlock.clockId)} />
          ) : (
            <div className="panel">
              <h3>Inspector</h3>
              <p className="muted">Click any segment in the day to see the block it belongs to: what was picked, why, and how the breaks were sized.</p>
              <p className="muted small">Every day is a dry run of the real engine. Change a clock rule and this view re-flows instantly; cursors advance from the channel's anchor, so what you see is what Next would play.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

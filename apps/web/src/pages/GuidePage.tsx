import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { blocksInWindow, fmtClock, HOUR, DAY, type ScheduledBlock } from '@mimictv/core';
import { useStore, dateStart, isoDate } from '../store/store';
import { useSims } from '../store/useSim';
import { useNow } from '../store/useNow';
import { DateBar } from '../components/DayPreview';
import BlockDetail from '../components/BlockDetail';
import { entryColor } from '../colors';

const WINDOW_H = 6;

export default function GuidePage() {
  const nav = useNavigate();
  const channels = useStore((s) => s.channels);
  const clocks = useStore((s) => s.clocks);
  const library = useStore((s) => s.library);
  const previewDate = useStore((s) => s.previewDate);
  const setPreviewDate = useStore((s) => s.setPreviewDate);
  const sorted = useMemo(() => [...channels].sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0)), [channels]);
  const sims = useSims();
  const dayStart = dateStart(previewDate);
  const now = useNow();
  const isToday = isoDate(now) === previewDate;
  const nowWindow = Math.floor(new Date(now).getHours() / WINDOW_H) * WINDOW_H;
  const [winStart, setWinStart] = useState<number>(() => isToday ? nowWindow : 6);
  const [sel, setSel] = useState<{ channelId: string; blockId: string }>();

  const start = dayStart + winStart * HOUR, end = start + WINDOW_H * HOUR;
  const nowInView = isToday && now >= start && now < end;
  const nowPct = ((now - start) / (end - start)) * 100;
  const jumpToNow = () => { setSel(undefined); setPreviewDate(isoDate(now)); setWinStart(nowWindow); };
  const selBlock: ScheduledBlock | undefined = sel ? sims.get(sel.channelId)?.blocks.find((b) => b.id === sel.blockId) : undefined;
  const showTitle = (id?: string) => library.shows.find((s) => s.id === id)?.title;

  return (
    <div>
      <div className="toolbar">
        <h1>Guide</h1>
        <div className="tabs">
          {[0, 6, 12, 18].map((h) => <button key={h} className={winStart === h ? 'on' : ''} onClick={() => setWinStart(h)}>{String(h).padStart(2, '0')}:00</button>)}
        </div>
        <button className={`btn sm now-btn${nowInView ? ' on' : ''}`} onClick={jumpToNow} title="Jump to what is airing right now">
          <i />Now · {fmtClock(now)}
        </button>
        <div className="grow" />
        <DateBar onChange={() => setSel(undefined)} />
      </div>
      {sorted.length === 0 ? (
        <div className="panel empty hero">
          <img src="/mimictv-512.png" alt="" />
          <div>No channels yet. <Link to="/channels">Make one</Link> and it shows up here.</div>
        </div>
      ) : (
        <div className="guide">
          <div className="panel guide-grid">
            <div className="ruler">
              <div />
              <div className="ticks">
                {Array.from({ length: WINDOW_H * 2 + 1 }, (_, i) => start + i * 30 * 60000).map((t, i) => (
                  <span key={t} style={{ left: `${(i / (WINDOW_H * 2)) * 100}%`, opacity: i % 2 ? 0.5 : 1 }}>{i === WINDOW_H * 2 ? '' : fmtClock(t)}</span>
                ))}
                {nowInView && <span className="nowflag" style={{ left: `${nowPct}%` }}>{fmtClock(now)}</span>}
              </div>
            </div>
            {sorted.map((ch) => {
              const sim = sims.get(ch.id);
              const blocks = sim ? blocksInWindow(sim, start, end) : [];
              return (
                <div className="guide-row" key={ch.id}>
                  <div className="chan" onClick={() => nav(`/channels/${ch.id}`)}><b>{ch.number}</b><span>{ch.name}</span></div>
                  <div className="track">
                    {blocks.flatMap((b) => {
                      // One span per programme, like an EPG: from a program's first part to the next program (or block end).
                      const firsts = b.entries.filter((e) => e.role === 'program' && e.partIndex === 0);
                      const spans = firsts.length > 0
                        ? firsts.map((e, i) => ({ e, s: e.start, f: firsts[i + 1]?.start ?? b.end }))
                        : [{ e: b.entries[0]!, s: b.start, f: b.end }];
                      return spans.filter((sp) => sp.f > start && sp.s < end).map(({ e, s: s0, f: f0 }) => {
                        const s = Math.max(s0, start), f = Math.min(f0, end);
                        const w = ((f - s) / (end - start)) * 100;
                        const dim = sel != null && !(sel.channelId === ch.id && sel.blockId === b.id);
                        const isProgram = e.role === 'program';
                        return (
                          <div key={e.id} className={`seg ${isProgram ? 'program' : 'filler'}${dim ? ' dim' : ''}`} title={`${fmtClock(s0)} ${showTitle(e.item.showId) ?? e.item.title}`}
                            style={{ left: `${((s - start) / (end - start)) * 100}%`, width: `${w}%`, background: isProgram ? entryColor(e.item, e.role) : undefined }}
                            onClick={() => setSel((cur) => (cur?.blockId === b.id ? undefined : { channelId: ch.id, blockId: b.id }))}>
                            {isProgram && w > 3 && (
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {showTitle(e.item.showId) ?? e.item.title}
                                {e.item.season != null && w > 6 && <small>S{String(e.item.season).padStart(2, '0')}E{String(e.item.episode).padStart(2, '0')} · {e.item.title}</small>}
                              </span>
                            )}
                          </div>
                        );
                      });
                    })}
                    {nowInView && <div className="nowline" style={{ left: `${nowPct}%` }} />}
                  </div>
                </div>
              );
            })}
            <div className="legend" style={{ marginTop: 10 }}>
              <span className="muted">{WINDOW_H}-hour window · one span per programme, breaks included · click to inspect the block</span>
              {isToday && !nowInView && <span className="muted">· now is {fmtClock(now)}, outside this window</span>}
              {!isToday && <span className="muted">· not today: press Now to see what's airing</span>}
            </div>
          </div>
          <div>
            {selBlock ? (
              <>
                <BlockDetail block={selBlock} clock={clocks.find((c) => c.id === selBlock.clockId)} />
                <div style={{ marginTop: 8 }}><Link className="btn sm" to={`/channels/${sel!.channelId}`}>Open channel</Link></div>
              </>
            ) : (
              <div className="panel"><h3>Inspector</h3><p className="muted">Every channel for the day, side by side. Click a program to see the block it belongs to.</p></div>
            )}
          </div>
        </div>
      )}
      <div className="muted small" style={{ marginTop: 10 }}>{new Date(dayStart).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · showing {fmtClock(start)}–{fmtClock(Math.min(end, dayStart + DAY))}</div>
    </div>
  );
}

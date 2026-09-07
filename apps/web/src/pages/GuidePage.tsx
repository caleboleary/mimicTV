import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { blocksInWindow, fmtClock, fmtDuration, HOUR, MIN, DAY, type Channel, type ScheduledBlock, type Simulation, type TimelineEntry } from '@mimictv/core';
import { useStore, dateStart, isoDate , useLibrary } from '../store/store';
import { useSims } from '../store/useSim';
import { useNow } from '../store/useNow';
import { DateBar } from '../components/DayPreview';
import BlockDetail from '../components/BlockDetail';
import Player from '../components/Player';
import { entryColor } from '../colors';

const MIN_HOURS = 0.5, MAX_HOURS = 24, DEFAULT_HOURS = 6;

/** Runs of consecutive non-program entries: one wash per break, whatever it holds. */
function breakRuns(entries: TimelineEntry[]): { s: number; f: number }[] {
  const runs: { s: number; f: number }[] = [];
  for (const e of entries) {
    if (e.role === 'program') continue;
    const last = runs[runs.length - 1];
    if (last && e.start - last.f < 1000) last.f = e.end; else runs.push({ s: e.start, f: e.end });
  }
  return runs;
}

/** One span per programme, like an EPG: from a program's first part to the next program (or block end). */
function programSpans(b: ScheduledBlock): { e: TimelineEntry; s: number; f: number }[] {
  const firsts = b.entries.filter((e) => e.role === 'program' && e.partIndex === 0);
  return firsts.length > 0 ? firsts.map((e, i) => ({ e, s: e.start, f: firsts[i + 1]?.start ?? b.end })) : [{ e: b.entries[0]!, s: b.start, f: b.end }];
}

/** The visible window: offset into the day and its length, both in ms. */
interface View { start: number; len: number }
const clampView = (v: View): View => {
  const len = Math.min(MAX_HOURS * HOUR, Math.max(MIN_HOURS * HOUR, v.len));
  return { len, start: Math.min(DAY - len, Math.max(0, v.start)) };
};

interface Tip { x: number; y: number; title: string; sub?: string; time: string }

export default function GuidePage() {
  const nav = useNavigate();
  const channels = useStore((s) => s.channels);
  const clocks = useStore((s) => s.clocks);
  const library = useLibrary();
  const previewDate = useStore((s) => s.previewDate);
  const setPreviewDate = useStore((s) => s.setPreviewDate);
  const nextUrl = useStore((s) => s.nextUrl);
  const sorted = useMemo(() => [...channels].sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0)), [channels]);
  const sims = useSims();
  const dayStart = dateStart(previewDate), dayEnd = dayStart + DAY;
  const now = useNow();
  const isToday = isoDate(now) === previewDate;
  const [view, setViewRaw] = useState<View>(() => clampView({ len: DEFAULT_HOURS * HOUR, start: (isoDate(Date.now()) === previewDate ? Date.now() - dateStart(previewDate) : 6 * HOUR) - (DEFAULT_HOURS * HOUR) / 2 }));
  const setView = (fn: (v: View) => View) => setViewRaw((v) => clampView(fn(v)));
  const [sel, setSel] = useState<{ channelId: string; blockId: string }>();
  const [watch, setWatch] = useState<Channel>();
  const [tip, setTip] = useState<Tip>();
  const trackRef = useRef<HTMLDivElement>(null);

  const start = dayStart + view.start, end = start + view.len;
  const pct = (t: number) => ((t - start) / view.len) * 100;
  const selBlock: ScheduledBlock | undefined = sel ? sims.get(sel.channelId)?.blocks.find((b) => b.id === sel.blockId) : undefined;
  const showTitle = (id?: string) => library.shows.find((s) => s.id === id)?.title;
  const epCode = (e: TimelineEntry) => (e.item.season != null ? `S${String(e.item.season).padStart(2, '0')}E${String(e.item.episode).padStart(2, '0')}` : undefined);
  const onAir = (ch: Channel): string | undefined => {
    const sim = sims.get(ch.id);
    const e = sim && blocksInWindow(sim, now, now + 1)[0]?.entries.find((x) => x.start <= now && now < x.end);
    return e && (e.role === 'program' ? showTitle(e.item.showId) ?? e.item.title : `break · ${e.item.title}`);
  };
  const jumpToNow = () => { setSel(undefined); setPreviewDate(isoDate(now)); setView((v) => ({ ...v, start: now - dateStart(isoDate(now)) - v.len / 2 })); };

  // Wheel over the strip scrubs along the day; ctrl/cmd+wheel zooms around the pointer, like a video editor.
  useEffect(() => {
    const el = trackRef.current; if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      if (e.ctrlKey || e.metaKey) {
        setView((v) => { const len = v.len * Math.exp(e.deltaY * 0.002); return { len, start: v.start + frac * (v.len - len) }; });
      } else {
        const d = e.deltaX || e.deltaY;
        setView((v) => ({ ...v, start: v.start + (d / rect.width) * v.len }));
      }
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [sorted.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dragging the strip pans it directly, like grabbing the timeline in an editor. A real drag swallows the click that would otherwise select a block.
  const stripDrag = useRef<{ x0: number; start0: number; moved: boolean }>();
  const onStripDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.chan')) return;
    suppressClick.current = false;
    stripDrag.current = { x0: e.clientX, start0: view.start, moved: false };
  };
  const onStripMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = stripDrag.current; if (!d) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 4) return;
    // Capture only once this is a real drag. Capturing on pointerdown would retarget the pointerup to the
    // strip, so the click would fire on the strip instead of the block and nothing could be selected.
    if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId);
    d.moved = true;
    const trackW = e.currentTarget.querySelector('.track')?.clientWidth ?? e.currentTarget.clientWidth;
    setView((v) => ({ ...v, start: d.start0 - (dx / trackW) * v.len }));
  };
  const onStripUp = () => { const d = stripDrag.current; stripDrag.current = undefined; if (d?.moved) suppressClick.current = true; };
  const suppressClick = useRef(false);
  const onStripClickCapture = (e: React.MouseEvent) => { if (suppressClick.current) { suppressClick.current = false; e.stopPropagation(); } };

  // Ruler: tick spacing follows the zoom so labels never collide.
  const step = view.len <= 3 * HOUR ? 15 * MIN : view.len <= 9 * HOUR ? 30 * MIN : view.len <= 14 * HOUR ? HOUR : 2 * HOUR;
  const labelEvery = step < 30 * MIN ? 2 : 1;
  const ticks: number[] = [];
  for (let t = Math.ceil((start - dayStart) / step) * step + dayStart; t <= end; t += step) ticks.push(t);
  const nowInView = isToday && now >= start && now < end;

  return (
    <div>
      <div className="toolbar">
        <h1>Guide</h1>
        <button className={`btn sm now-btn${nowInView ? ' on' : ''}`} onClick={jumpToNow} title="Jump to what is airing right now">
          <i />Now · {fmtClock(now)}
        </button>
        <span className="muted small">{fmtClock(start)}–{fmtClock(Math.min(end, dayEnd))} · {fmtDuration(view.len)}</span>
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
                {ticks.map((t, i) => (
                  <span key={t} className={(t - dayStart) % HOUR === 0 ? 'hour' : 'half'} style={{ left: `${pct(t)}%` }}>
                    {t < dayEnd && (labelEvery === 1 || ((t - dayStart) / step) % labelEvery === 0) ? fmtClock(t) : ''}
                  </span>
                ))}
                {nowInView && <span className="nowflag" style={{ left: `${pct(now)}%` }}>{fmtClock(now)}</span>}
              </div>
            </div>
            <div ref={trackRef} className="strip-rows" onPointerDown={onStripDown} onPointerMove={onStripMove} onPointerUp={onStripUp} onPointerCancel={onStripUp} onClickCapture={onStripClickCapture}>
              {sorted.map((ch) => {
                const sim = sims.get(ch.id);
                const blocks = sim ? blocksInWindow(sim, start, end) : [];
                return (
                  <div className="guide-row" key={ch.id}>
                    <div className="chan" onClick={() => nav(`/channels/${ch.id}`)}>
                      <b>{ch.number}</b><span>{ch.name}</span>
                      <button className="watch" title={nextUrl ? 'Watch this channel now' : 'Set ErsatzTV Next\'s address in Setup to watch here'} onClick={(e) => { e.stopPropagation(); if (nextUrl) setWatch(ch); else nav('/setup'); }}>▶</button>
                    </div>
                    <div className="track">
                      {blocks.flatMap((b) => programSpans(b).filter((sp) => sp.f > start && sp.s < end).map(({ e, s: s0, f: f0 }) => {
                        const s = Math.max(s0, start), f = Math.min(f0, end);
                        const w = ((f - s) / view.len) * 100;
                        const dim = sel != null && !(sel.channelId === ch.id && sel.blockId === b.id);
                        const isProgram = e.role === 'program';
                        const runs = isProgram ? breakRuns(b.entries.filter((x) => x.end > s && x.start < f)) : [];
                        const show = showTitle(e.item.showId);
                        const contentMs = b.entries.filter((x) => x.role === 'program' && x.item.id === e.item.id).reduce((n, x) => n + x.end - x.start, 0);
                        const tipFor = (ev: React.MouseEvent): Tip => ({
                          x: ev.clientX, y: ev.clientY,
                          title: isProgram ? show ?? e.item.title : e.item.title,
                          sub: isProgram ? [epCode(e), show ? e.item.title : undefined].filter(Boolean).join(' · ') : e.role,
                          time: `${fmtClock(s0)}–${fmtClock(f0)} · ${fmtDuration(contentMs || f0 - s0)}${isProgram && runs.length ? ` + ${runs.length} break${runs.length === 1 ? '' : 's'}` : ''}`,
                        });
                        return (
                          <div key={e.id} className={`seg ${isProgram ? 'program' : 'filler'}${dim ? ' dim' : ''}`}
                            style={{ left: `${pct(s)}%`, width: `${w}%`, background: isProgram ? entryColor(e.item, e.role) : undefined }}
                            onMouseEnter={(ev) => setTip(tipFor(ev))} onMouseMove={(ev) => setTip(tipFor(ev))} onMouseLeave={() => setTip(undefined)}
                            onClick={() => setSel((cur) => (cur?.blockId === b.id ? undefined : { channelId: ch.id, blockId: b.id }))}>
                            {runs.map((r) => <i key={r.s} className="brk" style={{ left: `${((Math.max(r.s, s) - s) / (f - s)) * 100}%`, width: `${((Math.min(r.f, f) - Math.max(r.s, s)) / (f - s)) * 100}%` }} />)}
                            {isProgram && (
                              <span>
                                {show ?? e.item.title}
                                {show && <small>{[epCode(e), e.item.title].filter(Boolean).join(' · ')}</small>}
                              </span>
                            )}
                          </div>
                        );
                      }))}
                      {!sim && <span className="track-hint muted small">no shows picked yet</span>}
                      {nowInView && <div className="nowline" style={{ left: `${pct(now)}%` }} />}
                    </div>
                  </div>
                );
              })}
            </div>
            <Navigator channels={sorted} sims={sims} dayStart={dayStart} view={view} setView={setView} nowMs={isToday ? now : undefined} />
            <div className="legend" style={{ marginTop: 10 }}>
              <span className="muted">drag the strip or the box below to move, the box's edges to zoom · wheel scrubs, ctrl+wheel zooms · darker bands are breaks · click to inspect · ▶ to watch</span>
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
      {tip && (
        <div className="tip" style={{ left: tip.x, top: tip.y, transform: tip.x > window.innerWidth - 320 ? 'translate(calc(-100% - 14px), 16px)' : 'translate(14px, 16px)' }}>
          <b>{tip.title}</b>
          {tip.sub && <div>{tip.sub}</div>}
          <div className="mono muted">{tip.time}</div>
        </div>
      )}
      {watch && <Player channel={watch} nowTitle={onAir(watch)} onClose={() => setWatch(undefined)} />}
      <div className="muted small" style={{ marginTop: 10 }}>{new Date(dayStart).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
    </div>
  );
}

/**
 * The whole day in miniature, one thin lane per channel, with a box over the part shown above.
 * Drag the box to pan, drag either edge to zoom, click elsewhere to jump there.
 */
function Navigator({ channels, sims, dayStart, view, setView, nowMs }: {
  channels: Channel[]; sims: Map<string, Simulation | undefined>; dayStart: number; view: View; setView: (fn: (v: View) => View) => void; nowMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const laneH = channels.length > 8 ? 3 : channels.length > 4 ? 4 : 6;
  const drag = useRef<{ mode: 'move' | 'l' | 'r'; x0: number; v0: View }>();
  const dayFrac = (clientX: number) => { const r = ref.current!.getBoundingClientRect(); return (clientX - r.left) / r.width; };
  const onDown = (mode: 'move' | 'l' | 'r') => (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x0: e.clientX, v0: view };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const r = ref.current!.getBoundingClientRect();
    const dt = ((e.clientX - d.x0) / r.width) * DAY;
    if (d.mode === 'move') setView(() => ({ ...d.v0, start: d.v0.start + dt }));
    else if (d.mode === 'l') setView(() => { const len = Math.max(MIN_HOURS * HOUR, d.v0.len - dt); return { len, start: d.v0.start + d.v0.len - len }; });
    else setView(() => ({ start: d.v0.start, len: Math.max(MIN_HOURS * HOUR, d.v0.len + dt) }));
  };
  const onUp = () => { drag.current = undefined; };
  const onStripDown = (e: React.PointerEvent) => { setView((v) => ({ ...v, start: dayFrac(e.clientX) * DAY - v.len / 2 })); };
  return (
    <div className="navigator">
      <div />
      <div className="nav-strip" ref={ref} onPointerDown={onStripDown}>
        {channels.map((ch) => {
          const sim = sims.get(ch.id);
          const blocks = sim ? blocksInWindow(sim, dayStart, dayStart + DAY) : [];
          return (
            <div className="nav-lane" key={ch.id} style={{ height: laneH }}>
              {blocks.flatMap((b) => programSpans(b).map(({ e, s, f }) => (
                <i key={e.id} style={{ left: `${((Math.max(s, dayStart) - dayStart) / DAY) * 100}%`, width: `${((Math.min(f, dayStart + DAY) - Math.max(s, dayStart)) / DAY) * 100}%`, background: e.role === 'program' ? entryColor(e.item, e.role) : undefined }} />
              )))}
            </div>
          );
        })}
        {nowMs != null && <div className="nowline" style={{ left: `${((nowMs - dayStart) / DAY) * 100}%` }} />}
        <div className="view-box" style={{ left: `${(view.start / DAY) * 100}%`, width: `${(view.len / DAY) * 100}%` }}
          onPointerDown={onDown('move')} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <span className="handle l" onPointerDown={onDown('l')} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
          <span className="handle r" onPointerDown={onDown('r')} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        </div>
        {[0, 6, 12, 18, 24].map((h) => <b key={h} style={{ left: `${(h / 24) * 100}%` }}>{h === 24 ? '' : `${String(h).padStart(2, '0')}:00`}</b>)}
      </div>
    </div>
  );
}

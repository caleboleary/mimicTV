import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { blocksInWindow, fmtClock, fmtDuration, HOUR, MIN, DAY, type Channel, type ScheduledBlock, type TimelineEntry } from '@mimictv/core';
import { useStore, dateStart, isoDate } from '../store/store';
import { useSims } from '../store/useSim';
import { useNow } from '../store/useNow';
import { DateBar } from '../components/DayPreview';
import BlockDetail from '../components/BlockDetail';
import Player from '../components/Player';
import { entryColor } from '../colors';

/** Hours that fit across the viewport at each zoom step. The whole day is always rendered; this only sets its width. */
const ZOOMS = [24, 12, 6, 2, 1] as const;
type Zoom = (typeof ZOOMS)[number];
/** Width of the sticky channel column plus its gap, mirrored in CSS (.ruler / .guide-row). */
const CHAN_PX = 178;

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

interface Tip { x: number; y: number; title: string; sub?: string; time: string }

export default function GuidePage() {
  const nav = useNavigate();
  const channels = useStore((s) => s.channels);
  const clocks = useStore((s) => s.clocks);
  const library = useStore((s) => s.library);
  const previewDate = useStore((s) => s.previewDate);
  const setPreviewDate = useStore((s) => s.setPreviewDate);
  const nextUrl = useStore((s) => s.nextUrl);
  const sorted = useMemo(() => [...channels].sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0)), [channels]);
  const sims = useSims();
  const dayStart = dateStart(previewDate), dayEnd = dayStart + DAY;
  const now = useNow();
  const isToday = isoDate(now) === previewDate;
  const [zoom, setZoom] = useState<Zoom>(() => { try { const z = Number(localStorage.getItem('mimictv-guide-zoom')); return (ZOOMS as readonly number[]).includes(z) ? (z as Zoom) : 6; } catch { return 6; } });
  const [sel, setSel] = useState<{ channelId: string; blockId: string }>();
  const [watch, setWatch] = useState<Channel>();
  const [tip, setTip] = useState<Tip>();
  const scrollRef = useRef<HTMLDivElement>(null);

  const selBlock: ScheduledBlock | undefined = sel ? sims.get(sel.channelId)?.blocks.find((b) => b.id === sel.blockId) : undefined;
  const showTitle = (id?: string) => library.shows.find((s) => s.id === id)?.title;
  const epCode = (e: TimelineEntry) => (e.item.season != null ? `S${String(e.item.season).padStart(2, '0')}E${String(e.item.episode).padStart(2, '0')}` : undefined);
  const onAir = (ch: Channel): string | undefined => {
    const sim = sims.get(ch.id);
    const e = sim && blocksInWindow(sim, now, now + 1)[0]?.entries.find((x) => x.start <= now && now < x.end);
    return e && (e.role === 'program' ? showTitle(e.item.showId) ?? e.item.title : `break · ${e.item.title}`);
  };

  // ---- scrolling along the day. The track is the inner width minus the sticky channel column.
  const timeAt = (clientFrac: number) => {
    const el = scrollRef.current; if (!el) return dayStart;
    const trackW = el.scrollWidth - CHAN_PX;
    return dayStart + ((el.scrollLeft + el.clientWidth * clientFrac - CHAN_PX) / trackW) * DAY;
  };
  const scrollTo = (t: number, frac = 0.5) => {
    const el = scrollRef.current; if (!el) return;
    const trackW = el.scrollWidth - CHAN_PX;
    el.scrollLeft = CHAN_PX + ((t - dayStart) / DAY) * trackW - el.clientWidth * frac;
  };
  const centerBeforeZoom = useRef<number>();
  const changeZoom = (z: Zoom) => { centerBeforeZoom.current = timeAt(0.5); setZoom(z); try { localStorage.setItem('mimictv-guide-zoom', String(z)); } catch { /* private mode */ } };
  useLayoutEffect(() => { if (centerBeforeZoom.current != null) { scrollTo(centerBeforeZoom.current); centerBeforeZoom.current = undefined; } }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nowJump, setNowJump] = useState(0);
  useEffect(() => { if (isToday) scrollTo(now); }, [nowJump, sorted.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps -- first paint and explicit jumps only
  const jumpToNow = () => { setSel(undefined); setPreviewDate(isoDate(now)); setNowJump((n) => n + 1); };
  // Plain wheel over the guide pans along the day, like scrubbing a timeline. Shift+wheel keeps the browser's own behaviour.
  useEffect(() => {
    // React's onWheel is passive; preventDefault needs a real listener.
    const el = scrollRef.current; if (!el) return;
    const h = (e: WheelEvent) => { if (e.deltaX === 0 && !e.shiftKey && el.scrollWidth > el.clientWidth) { el.scrollLeft += e.deltaY; e.preventDefault(); } };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [sorted.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const nowPct = ((now - dayStart) / DAY) * 100;
  const ticks = Array.from({ length: 49 }, (_, i) => dayStart + i * 30 * MIN);
  const labelEvery = zoom >= 24 ? 4 : zoom >= 12 ? 2 : 1; // in half-hour ticks

  return (
    <div>
      <div className="toolbar">
        <h1>Guide</h1>
        <div className="tabs" title="How much of the day fits across the screen">
          {ZOOMS.map((z) => <button key={z} className={zoom === z ? 'on' : ''} onClick={() => changeZoom(z)}>{z}h</button>)}
        </div>
        <button className={`btn sm now-btn${isToday ? ' on' : ''}`} onClick={jumpToNow} title="Jump to what is airing right now">
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
            <div className="guide-scroll" ref={scrollRef}>
              <div className="guide-inner" style={{ minWidth: `calc(${CHAN_PX}px + (100% - ${CHAN_PX}px) * ${24 / zoom})` }}>
                <div className="ruler">
                  <div className="sticky" />
                  <div className="ticks">
                    {ticks.map((t, i) => (
                      <span key={t} className={i % 2 ? 'half' : 'hour'} style={{ left: `${(i / 48) * 100}%` }}>
                        {i < 48 && i % labelEvery === 0 ? fmtClock(t) : ''}
                      </span>
                    ))}
                    {isToday && <span className="nowflag" style={{ left: `${nowPct}%` }}>{fmtClock(now)}</span>}
                  </div>
                </div>
                {sorted.map((ch) => {
                  const sim = sims.get(ch.id);
                  const blocks = sim ? blocksInWindow(sim, dayStart, dayEnd) : [];
                  return (
                    <div className="guide-row" key={ch.id}>
                      <div className="chan sticky" onClick={() => nav(`/channels/${ch.id}`)}>
                        <b>{ch.number}</b><span>{ch.name}</span>
                        <button className="watch" title={nextUrl ? 'Watch this channel now' : 'Set Next\'s address in Setup to watch here'} onClick={(e) => { e.stopPropagation(); if (nextUrl) setWatch(ch); else nav('/setup'); }}>▶</button>
                      </div>
                      <div className="track">
                        {blocks.flatMap((b) => {
                          // One span per programme, like an EPG: from a program's first part to the next program (or block end).
                          const firsts = b.entries.filter((e) => e.role === 'program' && e.partIndex === 0);
                          const spans = firsts.length > 0
                            ? firsts.map((e, i) => ({ e, s: e.start, f: firsts[i + 1]?.start ?? b.end }))
                            : [{ e: b.entries[0]!, s: b.start, f: b.end }];
                          return spans.filter((sp) => sp.f > dayStart && sp.s < dayEnd).map(({ e, s: s0, f: f0 }) => {
                            const s = Math.max(s0, dayStart), f = Math.min(f0, dayEnd);
                            const w = ((f - s) / DAY) * 100;
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
                                style={{ left: `${((s - dayStart) / DAY) * 100}%`, width: `${w}%`, background: isProgram ? entryColor(e.item, e.role) : undefined }}
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
                          });
                        })}
                        {isToday && <div className="nowline" style={{ left: `${nowPct}%` }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="legend" style={{ marginTop: 10 }}>
              <span className="muted">whole day · scroll sideways to move along it · darker bands are breaks · click to inspect the block · ▶ to watch</span>
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
      <div className="muted small" style={{ marginTop: 10 }}>{new Date(dayStart).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · {zoom} hour{zoom === 1 ? '' : 's'} across the screen</div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { poolItems, poolShows, fmtClock, newChannelAnchorMs, type Channel, type Clock, type MediaKind, type Pool, type ScheduledBlock } from '@mimictv/core';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
import { useStore , useLibrary } from '../store/store';
import { useRuleset, useSim } from '../store/useSim';
import Card, { Disclosure } from '../components/Card';
import PoolEditor, { MODES } from '../components/PoolEditor';
import FormatEditor from '../components/FormatEditor';
import DayPreview, { DateBar } from '../components/DayPreview';
import BlockDetail from '../components/BlockDetail';

type Role = 'program' | 'commercial' | 'network-id' | 'filler' | 'bumper';
const ROLE_LABEL: Record<Role, string> = { program: 'Shows', commercial: 'Commercials', 'network-id': 'Network IDs', filler: 'Filler / pad', bumper: 'Bumpers' };
type BumperSlot = 'before' | 'after' | 'afterProgram';
const BUMPER_LABEL: Record<BumperSlot, { title: string; hint: string }> = {
  afterProgram: { title: 'When a show ends', hint: '"Coming up next". Plays once, right after the program, before anything else.' },
  before: { title: 'Going into a break', hint: '"We\'ll be right back". First thing in every break.' },
  after: { title: 'Coming out of a break', hint: '"Now back to the show". Last thing in every break, after the network ID.' },
};

const HELP = {
  schedule: (
    <>
      <p><b>When each format runs.</b> By default one format covers the whole day. Add a time band to change things at a certain hour: cartoons in the morning, dramas at night.</p>
      <p>Each band has its own shows, format, and breaks. Pick a band here and the sections below edit that band. The last band of the day runs until the first one starts again.</p>
      <p>A <b>fixed show</b> is an appointment: "The Simpsons at 6pm". It plays at its time every day, the shows around it make room, and the day resumes afterwards.</p>
    </>
  ),
  shows: (
    <>
      <p><b>What plays.</b> Tick the shows this channel should draw from, then choose how to pick from them. "Shuffle shows, episodes in order" is the classic cable feel: a random show each slot, but every show works through its episodes in order.</p>
      <p>The channel stays blank until at least one show is ticked. "More options" holds the length range, a season range, and the "skip extras" box that keep stray files off the air.</p>
    </>
  ),
  format: (
    <>
      <p><b>The shape of each slot.</b> Pick a preset that sounds like your channel: half-hour show, hour drama, movies, back to back with no ads. "Customize" opens every knob underneath if a preset isn't quite right.</p>
      <p>When an episode has no chapter markers you can still cut it every N minutes or at set offsets, so a 44-minute drama gets real mid-rolls instead of one long break at the end.</p>
      <p>"Equalize" spreads the pad time evenly across every break so mid-rolls and the end-of-show break feel the same length. Watch the preview re-flow as you change these.</p>
    </>
  ),
  breaks: (
    <>
      <p><b>What fills the gaps.</b> Commercials play first in each break, filler pads any remainder, and a network ID plays last when a break ends near :00 or :30.</p>
      <p>Each one is a pool. A private pool belongs to this channel; a shared collection is reused across channels and edited in the Library. Use saved searches to narrow a pool, e.g. "nike" in your commercials folder.</p>
      <p>Underneath: "Different ads for some shows" swaps the commercial pool while certain shows are on, and "Bumpers" adds short stings when a show ends, going into a break, and coming out of one.</p>
    </>
  ),
  identity: (
    <>
      <p><b>How the channel appears to players.</b> The tvg_id names the guide file that Plex, Jellyfin, or your IPTV app reads. Group and logo pass through to the lineup.</p>
      <p>The anchor is the moment this channel's timeline began. The seed makes the "random" choices repeatable, so the same setup always produces the same day.</p>
    </>
  ),
};

const minuteLabel = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const timeValue = (m: number) => minuteLabel(Math.min(m, 23 * 60 + 59));
const parseMinute = (v: string): number | undefined => { const [h, m] = v.split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h! * 60 + m! : undefined; };

function scheduleSummary(parts: Channel['dayparts']): string {
  const bands = parts.filter((d) => d.endMinute == null).length;
  const fixed = parts.length - bands;
  return [bands <= 1 ? 'all day' : `${bands} bands`, fixed > 0 ? `${fixed} fixed show${fixed === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
}

function breakSummary(c: Clock): string {
  const fb = c.breaks.fallback;
  const fallback = !fb || fb.mode === 'none' ? '' : fb.mode === 'interval' ? `every ${Math.round(fb.everyMs / 60000)} min` : `at ${fb.offsetsMs.map((m) => Math.round(m / 60000)).join('/')} min`;
  if (c.breaks.atChapters) return fallback ? `chapters, else ${fallback}` : 'breaks at chapters';
  return fallback ? `breaks ${fallback}` : 'no mid-rolls';
}

function poolFitsRole(p: Pool, role: Role): boolean {
  const kinds = p.filter.kinds ?? [];
  if (role === 'program') return kinds.length === 0 || kinds.includes('episode') || kinds.includes('movie');
  return kinds.includes(role);
}

/** Picker + inline editor for one pool role on a channel's band. */
function PoolSlot({ role, poolId, channelId, onPick }: { role: Role; poolId: string; channelId: string; onPick: (id: string) => void }) {
  const pools = useStore((s) => s.pools);
  const clocks = useStore((s) => s.clocks);
  const channels = useStore((s) => s.channels);
  const library = useLibrary();
  const updatePool = useStore((s) => s.updatePool);
  const promotePool = useStore((s) => s.promotePool);
  const detachPool = useStore((s) => s.detachPool);
  const createInlinePool = useStore((s) => s.createInlinePool);
  const removePool = useStore((s) => s.removePool);

  const pool = pools.find((p) => p.id === poolId);
  const mine = pools.filter((p) => p.ownerChannelId === channelId && poolFitsRole(p, role));
  const shared = pools.filter((p) => !p.ownerChannelId && poolFitsRole(p, role));
  const usedBy = (pid: string) => new Set(clocks.filter((c) => [c.program.poolId, c.breaks.poolId, c.networkId.poolId, c.pad.poolId].includes(pid)).flatMap((c) => channels.filter((ch) => ch.dayparts.some((d) => d.clockId === c.id)).map((ch) => ch.id))).size;

  const onSelect = (v: string) => {
    if (v === '__new__') onPick(createInlinePool(channelId, role === 'program' ? 'episode' : role));
    else onPick(v);
  };

  return (
    <div>
      <div className="pool-mode">
        <select value={pool ? pool.id : ''} onChange={(e) => onSelect(e.target.value)}>
          {!pool && <option value="">(none)</option>}
          {mine.length > 0 && <optgroup label="This channel">{mine.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
          {shared.length > 0 && <optgroup label="Shared collections">{shared.map((p) => <option key={p.id} value={p.id}>{p.name} · {poolItems(p, library).length}</option>)}</optgroup>}
          <option value="__new__">+ new private {role === 'program' ? 'show list' : 'pool'}</option>
          {role !== 'program' && pool && <option value="">(none)</option>}
        </select>
        {pool && pool.ownerChannelId === channelId && (
          <>
            <button className="btn sm" onClick={() => { const name = prompt('Name for the shared collection', pool.name); if (name) promotePool(pool.id, name); }}>Make reusable</button>
            {mine.length > 1 && <button className="btn sm danger" onClick={() => { if (confirm('Delete this private pool?')) { removePool(pool.id); onPick(mine.find((p) => p.id !== pool.id)!.id); } }}>Delete</button>}
          </>
        )}
      </div>
      {pool && pool.ownerChannelId === channelId && role === 'program' && (
        <PoolEditor pool={pool} library={library} mode="program" onChange={(patch) => updatePool(pool.id, patch)} />
      )}
      {pool && pool.ownerChannelId === channelId && role !== 'program' && (
        <div>
          <div className="pool-summary">
            <span>{poolItems(pool, library).length} items · {MODES.find((m) => m.v === pool.selection)?.label.toLowerCase()}{pool.filter.any?.length ? ` · ${pool.filter.any.length} saved search${pool.filter.any.length === 1 ? '' : 'es'}` : ' · everything of this kind'}</span>
          </div>
          <Disclosure label="Edit" openLabel="Done editing">
            <PoolEditor pool={pool} library={library} mode="interstitial" onChange={(patch) => updatePool(pool.id, patch)} />
          </Disclosure>
        </div>
      )}
      {pool && !pool.ownerChannelId && (
        <div className="shared-note">
          <span>Shared collection · {poolItems(pool, library).length} items · {MODES.find((m) => m.v === pool.selection)?.label} · used by {usedBy(pool.id)} channel{usedBy(pool.id) === 1 ? '' : 's'}</span>
          <Link to={`/library?tab=collections&pool=${pool.id}`} className="btn sm">Edit in Library</Link>
          <button className="btn sm" onClick={() => onPick(detachPool(pool.id, channelId))}>Make a private copy</button>
        </div>
      )}
      {!pool && role !== 'program' && <div className="muted small">None: {role === 'commercial' ? 'breaks will hold only filler' : role === 'network-id' ? 'no station IDs' : role === 'bumper' ? 'no bumper here' : 'gaps are padded with black'}.</div>}
    </div>
  );
}

export default function ChannelEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const channels = useStore((s) => s.channels);
  const clocks = useStore((s) => s.clocks);
  const pools = useStore((s) => s.pools);
  const library = useLibrary();
  const previewDate = useStore((s) => s.previewDate);
  const updateChannel = useStore((s) => s.updateChannel);
  const updateClock = useStore((s) => s.updateClock);
  const addClock = useStore((s) => s.addClock);
  const addBand = useStore((s) => s.addBand);
  const addFixedShow = useStore((s) => s.addFixedShow);
  const removeBand = useStore((s) => s.removeBand);
  const duplicateChannel = useStore((s) => s.duplicateChannel);
  const removeChannel = useStore((s) => s.removeChannel);
  const ruleset = useRuleset();

  const channel = channels.find((c) => c.id === id);
  const sim = useSim(channel);
  const [bandIdx, setBandIdx] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [status, setStatus] = useState<string>();

  const band = channel?.dayparts[Math.min(bandIdx, (channel?.dayparts.length ?? 1) - 1)];
  const clock = clocks.find((c) => c.id === band?.clockId);
  const programPool = pools.find((p) => p.id === clock?.program.poolId);
  const selectedBlock = useMemo(() => sim?.blocks.find((b) => b.id === selected), [sim, selected]);
  const clockUsedBy = clock ? channels.filter((ch) => ch.dayparts.some((d) => d.clockId === clock.id)).length : 0;

  if (!channel) return <div className="empty">Channel not found. <Link to="/channels">Back to channels</Link></div>;

  const setClock = (patch: (c: Clock) => Clock) => clock && updateClock(clock.id, patch);
  const pickPool = (role: Role) => (pid: string) => setClock((c) => role === 'program' ? { ...c, program: { ...c.program, poolId: pid } } : role === 'commercial' ? { ...c, breaks: { ...c.breaks, poolId: pid } } : role === 'network-id' ? { ...c, networkId: { ...c.networkId, poolId: pid } } : { ...c, pad: { ...c.pad, poolId: pid } });
  const pickBumper = (slot: BumperSlot) => (pid: string) => setClock((c) => ({ ...c, breaks: { ...c.breaks, bumpers: { ...c.breaks.bumpers, [slot]: pid || undefined } } }));
  const overrides = clock?.breaks.overrides ?? [];
  const setOverrides = (next: { showIds: string[]; poolId: string }[]) => setClock((c) => ({ ...c, breaks: { ...c.breaks, overrides: next.length ? next : undefined } }));
  const adPools = pools.filter((p) => poolFitsRole(p, 'commercial') && (!p.ownerChannelId || p.ownerChannelId === channel?.id));
  const bandShows = programPool ? poolShows(programPool, library).map((s) => s.showId) : [];
  const bumperCount = clock ? (['before', 'after', 'afterProgram'] as BumperSlot[]).filter((s) => clock.breaks.bumpers?.[s]).length : 0;
  const makeClockPrivate = () => {
    if (!clock || !band) return;
    const copy: Clock = { ...structuredClone(clock), id: `clock-${Date.now().toString(36)}`, ownerChannelId: channel.id };
    addClock(copy);
    updateChannel(channel.id, (c) => ({ ...c, dayparts: c.dayparts.map((d) => (d.clockId === band.clockId ? { ...d, clockId: copy.id } : d)) }));
  };
  const fixedShowName = (clockId: string) => {
    const p = pools.find((x) => x.id === clocks.find((c) => c.id === clockId)?.program.poolId);
    const ids = p?.filter.showIds ?? [];
    if (ids.length === 0) return undefined;
    const first = library.shows.find((s) => s.id === ids[0])?.title ?? ids[0];
    return ids.length > 1 ? `${first} +${ids.length - 1}` : first;
  };
  const showCount = programPool ? (programPool.filter.showIds?.length || new Set(poolItems(programPool, library).map((i) => i.showId)).size) : 0;
  const onSelectBlock = (b: ScheduledBlock) => setSelected((cur) => (cur === b.id ? undefined : b.id));

  return (
    <div>
      <div className="toolbar">
        <Link to="/channels" className="muted small">← Channels</Link>
        <div className="grow" />
        <DateBar onChange={() => setSelected(undefined)} />
      </div>
      <div className="editor">
        <div className="recipe">
          <div className="ident">
            <input className="num" type="text" value={channel.number} onChange={(e) => updateChannel(channel.id, (c) => ({ ...c, number: e.target.value }))} />
            <input className="name" type="text" value={channel.name} onChange={(e) => updateChannel(channel.id, (c) => ({ ...c, name: e.target.value }))} />
          </div>

          <Card title="Schedule" help={HELP.schedule} summary={scheduleSummary(channel.dayparts)} open={channel.dayparts.length > 1}>
            <div className="bands">
              {channel.dayparts.map((d, i) => {
                const fixed = d.endMinute != null;
                const showName = fixed ? fixedShowName(d.clockId) : undefined;
                return (
                  <button key={i} className={`band${band === d ? ' on' : ''}${fixed ? ' fixed' : ''}`} onClick={() => setBandIdx(i)} title={fixed ? 'Fixed show: plays at this time, then the day resumes' : 'Time band'}>
                    {fixed ? `📌 ${minuteLabel(d.startMinute)}–${minuteLabel(d.endMinute!)} · ${showName ?? 'pick a show'}`
                      : channel.dayparts.filter((x) => x.endMinute == null).length === 1 ? 'All day'
                      : `${minuteLabel(d.startMinute)} · ${clocks.find((c) => c.id === d.clockId)?.name ?? '?'}`}
                  </button>
                );
              })}
              <button className="btn sm" onClick={() => clock && addBand(channel.id, 20 * 60, clock.id)}>+ time band</button>
              <button className="btn sm" onClick={() => clock && addFixedShow(channel.id, 18 * 60, 30, clock.id)}>+ fixed show</button>
            </div>
            {band && clock && (band.endMinute != null || channel.dayparts.length > 1) && (
              <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
                <label className="field">{band.endMinute != null ? 'Plays at' : 'Starts at'}
                  <input type="time" step={900} value={timeValue(band.startMinute)} onChange={(e) => { const m = parseMinute(e.target.value); if (m == null) return; updateChannel(channel.id, (c) => ({ ...c, dayparts: c.dayparts.map((d) => (d === band ? { ...d, startMinute: m, endMinute: d.endMinute != null ? Math.min(24 * 60, m + (d.endMinute - d.startMinute)) : undefined } : d)).sort((a, b) => a.startMinute - b.startMinute) })); }} />
                </label>
                {band.endMinute != null && (
                  <label className="field">For
                    <select value={band.endMinute - band.startMinute} onChange={(e) => { const len = Number(e.target.value); updateChannel(channel.id, (c) => ({ ...c, dayparts: c.dayparts.map((d) => (d === band ? { ...d, endMinute: Math.min(24 * 60, d.startMinute + len) } : d)) })); }}>
                      {[30, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hour${m > 60 ? 's' : ''}`}</option>)}
                    </select>
                  </label>
                )}
                {band.endMinute == null && <label className="field">Band name<input type="text" value={clock.name} onChange={(e) => setClock((c) => ({ ...c, name: e.target.value }))} /></label>}
                <div className="grow" />
                <button className="btn sm danger" onClick={() => { removeBand(channel.id, channel.dayparts.indexOf(band)); setBandIdx(0); }}>{band.endMinute != null ? 'Remove fixed show' : 'Remove band'}</button>
              </div>
            )}
            {band && (band.endMinute != null || channel.dayparts.length > 1) && (
              <Disclosure label={band.days?.length || band.dates ? `Only on certain days (${[band.days?.length ? band.days.map((d) => DAYS[d]).join(' ') : '', band.dates ? `${band.dates.from} to ${band.dates.to}` : ''].filter(Boolean).join(', ')})` : 'Only on certain days'}>
                <div className="toolbar" style={{ marginBottom: 8 }}>
                  <div className="chips">
                    {DAYS.map((name, d) => { const on = band.days?.includes(d) ?? false; return <button key={d} className={`chip${on ? ' on' : ''}`} onClick={() => updateChannel(channel.id, (c) => ({ ...c, dayparts: c.dayparts.map((x) => (x === band ? { ...x, days: (() => { const next = on ? (x.days ?? []).filter((y) => y !== d) : [...(x.days ?? []), d]; return next.length ? next.sort() : undefined; })() } : x)) }))}>{name}</button>; })}
                  </div>
                  <span className="muted small">{band.days?.length ? '' : 'every day'}</span>
                </div>
                <div className="toolbar" style={{ marginBottom: 0 }}>
                  <span className="muted small">Between</span>
                  <input type="text" placeholder="12-01" style={{ width: 70 }} value={band.dates?.from ?? ''} onChange={(e) => updateChannel(channel.id, (c) => ({ ...c, dayparts: c.dayparts.map((x) => (x === band ? { ...x, dates: e.target.value || x.dates?.to ? { from: e.target.value, to: x.dates?.to ?? '' } : undefined } : x)) }))} />
                  <span className="muted small">and</span>
                  <input type="text" placeholder="12-31" style={{ width: 70 }} value={band.dates?.to ?? ''} onChange={(e) => updateChannel(channel.id, (c) => ({ ...c, dayparts: c.dayparts.map((x) => (x === band ? { ...x, dates: e.target.value || x.dates?.from ? { from: x.dates?.from ?? '', to: e.target.value } : undefined } : x)) }))} />
                  <span className="muted small">(month-day, may wrap the new year; blank = all year)</span>
                </div>
              </Disclosure>
            )}
            <p className="muted small" style={{ marginBottom: 0 }}>
              {band?.endMinute != null
                ? 'A fixed show plays at its time every day, then the day picks up where it left off. Choose the show in the Shows section below.'
                : 'Each band runs its own format and shows until the next band starts. The sections below edit the selected band.'}
            </p>
          </Card>

          {channel.mirrorOf ? (
            <div className="panel muted small">This channel mirrors <b>{channels.find((c) => c.id === channel.mirrorOf)?.name ?? '?'}</b> {(channel.shiftMinutes ?? 0) / 60} hours later. Edit that channel to change what plays here; see Identity to stop mirroring.</div>
          ) : clock ? (
            <>
              <Card title="Shows" help={HELP.shows} summary={clock.offAir ? 'off air' : programPool ? `${showCount} shows · ${MODES.find((m) => m.v === programPool.selection)?.label.toLowerCase()}` : 'none'}>
                {clock.offAir ? (
                  <p className="muted small" style={{ margin: 0 }}>This band is off air: only the filler pool plays. Pick another format preset to bring shows back.</p>
                ) : (
                  <>
                    <PoolSlot role="program" poolId={clock.program.poolId} channelId={channel.id} onPick={pickPool('program')} />
                    {programPool && sim && (
                      <Disclosure label="Where each show is">
                        <p className="muted small" style={{ marginTop: 0 }}>Next episode of each show after the preview day. "Start over" or jump to an episode; the change applies from the channel's next published break.</p>
                        <div className="recipe" style={{ gap: 4 }}>
                          {poolShows(programPool, library).map(({ showId, episodes }) => {
                            const idx = (sim.cursors.showNext[showId] ?? 0) % episodes.length;
                            const ep = episodes[idx]!;
                            const title = library.shows.find((s) => s.id === showId)?.title ?? showId;
                            const seedTo = (n: number | undefined) => updateChannel(channel.id, (c) => { const seeds = { ...(c.cursorSeeds ?? {}) }; if (n == null) delete seeds[showId]; else seeds[showId] = n; return { ...c, cursorSeeds: Object.keys(seeds).length ? seeds : undefined }; });
                            return (
                              <div key={showId} className="toolbar" style={{ marginBottom: 0, gap: 8 }}>
                                <span style={{ minWidth: 160 }}>{title}</span>
                                <span className="muted small mono">next S{String(ep.season).padStart(2, '0')}E{String(ep.episode).padStart(2, '0')} · {idx + 1}/{episodes.length}</span>
                                <div className="grow" />
                                <select value="" onChange={(e) => { if (e.target.value !== '') seedTo(Number(e.target.value)); }}>
                                  <option value="">jump to…</option>
                                  {episodes.map((x, i) => <option key={x.id} value={i}>S{String(x.season).padStart(2, '0')}E{String(x.episode).padStart(2, '0')} {x.title}</option>)}
                                </select>
                                <button className="btn sm" onClick={() => seedTo(0)}>Start over</button>
                                {channel.cursorSeeds?.[showId] != null && <button className="btn sm" title="Forget the jump" onClick={() => seedTo(undefined)}>×</button>}
                              </div>
                            );
                          })}
                        </div>
                      </Disclosure>
                    )}
                  </>
                )}
              </Card>
              <Card title="Format" help={HELP.format} summary={`${Math.round(clock.program.targetMs / 60000)} min · pad :${clock.pad.toMinutes} · ${breakSummary(clock)}`} open={false}>
                {!clock.ownerChannelId && clockUsedBy > 1 && (
                  <div className="shared-note" style={{ marginBottom: 10 }}>
                    <span>This format is shared by {clockUsedBy} channels. Changes affect all of them.</span>
                    <button className="btn sm" onClick={makeClockPrivate}>Make a private copy</button>
                  </div>
                )}
                <FormatEditor clock={clock} onChange={setClock} />
              </Card>
              <Card title="Breaks" help={HELP.breaks} summary={[clock.breaks.poolId && 'ads', clock.networkId.enabled && clock.networkId.poolId && 'IDs', clock.pad.poolId && 'filler', bumperCount > 0 && `${bumperCount} bumper${bumperCount === 1 ? '' : 's'}`, overrides.length > 0 && 'show-specific ads'].filter(Boolean).join(' · ') || 'nothing'} open={false}>
                <div className="recipe" style={{ gap: 16 }}>
                  {(['commercial', 'network-id', 'filler'] as Role[]).map((role) => (
                    <div key={role}>
                      <h3 style={{ marginBottom: 6 }}>{ROLE_LABEL[role]}</h3>
                      <PoolSlot role={role} poolId={role === 'commercial' ? clock.breaks.poolId : role === 'network-id' ? clock.networkId.poolId : clock.pad.poolId} channelId={channel.id} onPick={pickPool(role)} />
                      {role === 'commercial' && (
                        <Disclosure label={overrides.length ? `Different ads for some shows (${overrides.length})` : 'Different ads for some shows'}>
                          <div className="recipe" style={{ gap: 10 }}>
                            {overrides.map((o, i) => (
                              <div key={i} className="override">
                                <div className="chips" style={{ flexWrap: 'wrap' }}>
                                  {bandShows.map((sid) => {
                                    const on = o.showIds.includes(sid);
                                    const title = library.shows.find((s) => s.id === sid)?.title ?? sid;
                                    return <button key={sid} className={`chip${on ? ' on' : ''}`} onClick={() => setOverrides(overrides.map((x, j) => j === i ? { ...x, showIds: on ? x.showIds.filter((y) => y !== sid) : [...x.showIds, sid] } : x))}>{title}</button>;
                                  })}
                                  {bandShows.length === 0 && <span className="muted small">Pick shows in the Shows section first.</span>}
                                </div>
                                <div className="toolbar" style={{ marginBottom: 0 }}>
                                  <span className="muted small">use</span>
                                  <select value={o.poolId} onChange={(e) => setOverrides(overrides.map((x, j) => j === i ? { ...x, poolId: e.target.value } : x))}>
                                    <option value="">(pick a commercial pool)</option>
                                    {adPools.map((p) => <option key={p.id} value={p.id}>{p.name} · {poolItems(p, library).length}</option>)}
                                  </select>
                                  <div className="grow" />
                                  <button className="btn sm" onClick={() => setOverrides(overrides.filter((_, j) => j !== i))}>×</button>
                                </div>
                              </div>
                            ))}
                            <div><button className="btn sm" onClick={() => setOverrides([...overrides, { showIds: [], poolId: '' }])}>+ add a rule</button></div>
                            <p className="muted small" style={{ margin: 0 }}>While one of the ticked shows is on, its breaks draw from that pool instead. Make a pool in the Library as a shared collection, or "+ new private pool" above, then pick it here.</p>
                          </div>
                        </Disclosure>
                      )}
                    </div>
                  ))}
                  <Disclosure label={bumperCount ? `Bumpers (${bumperCount})` : 'Bumpers'}>
                    <div className="recipe" style={{ gap: 14 }}>
                      {(['afterProgram', 'before', 'after'] as BumperSlot[]).map((slot) => (
                        <div key={slot}>
                          <h3 style={{ marginBottom: 2 }}>{BUMPER_LABEL[slot].title}</h3>
                          <p className="muted small" style={{ margin: '0 0 6px' }}>{BUMPER_LABEL[slot].hint}</p>
                          <PoolSlot role="bumper" poolId={clock.breaks.bumpers?.[slot] ?? ''} channelId={channel.id} onPick={pickBumper(slot)} />
                        </div>
                      ))}
                    </div>
                  </Disclosure>
                </div>
              </Card>
            </>
          ) : (
            <div className="panel empty">This band points at a missing format. Remove the band or add a new one.</div>
          )}

          <Card title="Identity" help={HELP.identity} summary={channel.tvgId} open={false}>
            <div className="form-grid">
              <label className="field">tvg_id<input type="text" value={channel.tvgId} onChange={(e) => updateChannel(channel.id, (c) => ({ ...c, tvgId: e.target.value }))} /></label>
              <label className="field">Group<input type="text" value={channel.group ?? ''} onChange={(e) => updateChannel(channel.id, (c) => ({ ...c, group: e.target.value }))} /></label>
              <label className="field">Logo path<input type="text" value={channel.logo ?? ''} onChange={(e) => updateChannel(channel.id, (c) => ({ ...c, logo: e.target.value }))} /></label>
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>Timeline anchored {new Date(channel.anchorMs).toLocaleDateString()} {fmtClock(channel.anchorMs)} · seed <code>{channel.seed}</code></div>
            {channels.length > 1 && (
              <Disclosure label={channel.mirrorOf ? `Mirrors ${channels.find((c) => c.id === channel.mirrorOf)?.name ?? '?'}, ${(channel.shiftMinutes ?? 0) / 60}h later` : 'Mirror another channel (east/west feed)'}>
                <div className="toolbar" style={{ marginBottom: 0 }}>
                  <label className="field">Same as
                    <select value={channel.mirrorOf ?? ''} onChange={(e) => updateChannel(channel.id, (c) => ({ ...c, mirrorOf: e.target.value || undefined, shiftMinutes: e.target.value ? (c.shiftMinutes ?? 180) : undefined }))}>
                      <option value="">(not a mirror)</option>
                      {channels.filter((c) => c.id !== channel.id && !c.mirrorOf).map((c) => <option key={c.id} value={c.id}>{c.number} {c.name}</option>)}
                    </select>
                  </label>
                  {channel.mirrorOf && (
                    <label className="field">Delayed by
                      <select value={channel.shiftMinutes ?? 180} onChange={(e) => updateChannel(channel.id, (c) => ({ ...c, shiftMinutes: Number(e.target.value) }))}>
                        {[60, 120, 180, 240, 360].map((m) => <option key={m} value={m}>{m / 60} hour{m > 60 ? 's' : ''}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <p className="muted small" style={{ margin: '8px 0 0' }}>A mirror plays exactly what its source played, that many hours later. It has no recipe of its own.</p>
              </Disclosure>
            )}
          </Card>

          <div className="toolbar">
            <button className="btn sm" onClick={() => nav(`/channels/${duplicateChannel(channel.id)}`)}>Duplicate</button>
            <button className="btn sm" title="Forget everything written for this channel and start its timeline again at the current half hour. Whatever is playing on it now is cut off." onClick={async () => {
              if (!confirm('Restart this channel from now? Its history is forgotten and whatever is playing on it is cut off.')) return;
              const anchorMs = newChannelAnchorMs();
              const r = await fetch(`/api/channels/${channel.id}/restart`, { method: 'POST', body: JSON.stringify({ anchorMs }), headers: { 'Content-Type': 'application/json' } }).catch(() => undefined);
              if (r?.ok) { updateChannel(channel.id, (c) => ({ ...c, anchorMs })); setStatus('✓ restarted from ' + fmtClock(anchorMs)); } else setStatus('restart failed: is the service running?');
            }}>Restart from now</button>
            <div className="grow" />
            <button className="btn sm danger" onClick={() => { if (confirm('Delete this channel and its private pools?')) { removeChannel(channel.id); nav('/channels'); } }}>Delete</button>
          </div>
          {status && <div className="small" style={{ color: status.startsWith('✓') ? 'var(--ok)' : 'var(--warn)' }}>{status}</div>}
        </div>

        <div className="recipe">
          <DayPreview channel={channel} sim={sim} selectedBlockId={selected} onSelect={onSelectBlock} />
          {selectedBlock && <BlockDetail block={selectedBlock} clock={clocks.find((c) => c.id === selectedBlock.clockId)} />}
        </div>
      </div>
    </div>
  );
}

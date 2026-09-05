import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { poolItems, fmtClock, type Clock, type MediaKind, type Pool, type ScheduledBlock } from '@mimictv/core';
import { useStore } from '../store/store';
import { useRuleset, useSim } from '../store/useSim';
import { exportDay } from '../export';
import Card, { Disclosure } from '../components/Card';
import PoolEditor, { MODES } from '../components/PoolEditor';
import FormatEditor from '../components/FormatEditor';
import DayPreview, { DateBar } from '../components/DayPreview';
import BlockDetail from '../components/BlockDetail';

type Role = 'program' | 'commercial' | 'network-id' | 'filler';
const ROLE_LABEL: Record<Role, string> = { program: 'Shows', commercial: 'Commercials', 'network-id': 'Network IDs', filler: 'Filler / pad' };

const HELP = {
  schedule: (
    <>
      <p><b>When each format runs.</b> By default one format covers the whole day. Add a time band to change things at a certain hour: cartoons in the morning, dramas at night.</p>
      <p>Each band has its own shows, format, and breaks. Pick a band here and the sections below edit that band. The last band of the day runs until the first one starts again.</p>
    </>
  ),
  shows: (
    <>
      <p><b>What plays.</b> Tick the shows this channel should draw from, then choose how to pick from them. "Shuffle shows, episodes in order" is the classic cable feel: a random show each slot, but every show works through its episodes in order.</p>
      <p>Leave no shows ticked to use every show in the library. "More options" holds the length range, a season range, and the "skip extras" box that keep stray files off the air.</p>
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
    </>
  ),
  identity: (
    <>
      <p><b>How the channel appears to players.</b> The tvg_id names the guide file that Plex, Jellyfin, or your IPTV app reads. Group and logo pass through to the lineup.</p>
      <p>The anchor is the moment this channel's timeline began. The seed makes the "random" choices repeatable, so the same setup always produces the same day.</p>
    </>
  ),
};

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
  const library = useStore((s) => s.library);
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
          {!pool && <option value="">— none —</option>}
          {mine.length > 0 && <optgroup label="This channel">{mine.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
          {shared.length > 0 && <optgroup label="Shared collections">{shared.map((p) => <option key={p.id} value={p.id}>{p.name} · {poolItems(p, library).length}</option>)}</optgroup>}
          <option value="__new__">+ new private {role === 'program' ? 'show list' : 'pool'}</option>
          {role !== 'program' && pool && <option value="">— none —</option>}
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
      {!pool && role !== 'program' && <div className="muted small">None: {role === 'commercial' ? 'breaks will hold only filler' : role === 'network-id' ? 'no station IDs' : 'gaps are padded with black'}.</div>}
    </div>
  );
}

export default function ChannelEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const channels = useStore((s) => s.channels);
  const clocks = useStore((s) => s.clocks);
  const pools = useStore((s) => s.pools);
  const library = useStore((s) => s.library);
  const previewDate = useStore((s) => s.previewDate);
  const updateChannel = useStore((s) => s.updateChannel);
  const updateClock = useStore((s) => s.updateClock);
  const addClock = useStore((s) => s.addClock);
  const addBand = useStore((s) => s.addBand);
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
  const makeClockPrivate = () => {
    if (!clock || !band) return;
    const copy: Clock = { ...structuredClone(clock), id: `clock-${Date.now().toString(36)}`, ownerChannelId: channel.id };
    addClock(copy);
    updateChannel(channel.id, (c) => ({ ...c, dayparts: c.dayparts.map((d) => (d.clockId === band.clockId ? { ...d, clockId: copy.id } : d)) }));
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

          <Card title="Schedule" help={HELP.schedule} summary={channel.dayparts.length === 1 ? 'all day' : `${channel.dayparts.length} bands`} open={channel.dayparts.length > 1}>
            <div className="bands">
              {channel.dayparts.map((d, i) => (
                <button key={i} className={`band${band === d ? ' on' : ''}`} onClick={() => setBandIdx(i)}>
                  {channel.dayparts.length === 1 ? 'All day' : `${fmtClock(new Date(2000, 0, 1, Math.floor(d.startMinute / 60), d.startMinute % 60).getTime())} · ${clocks.find((c) => c.id === d.clockId)?.name ?? '?'}`}
                </button>
              ))}
              <button className="btn sm" onClick={() => clock && addBand(channel.id, 20 * 60, clock.id)}>+ time band</button>
            </div>
            {channel.dayparts.length > 1 && band && clock && (
              <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
                <label className="field">Starts at
                  <input type="number" min={0} max={23} value={Math.floor(band.startMinute / 60)} onChange={(e) => { const h = Number(e.target.value); updateChannel(channel.id, (c) => ({ ...c, dayparts: c.dayparts.map((d) => (d === band ? { ...d, startMinute: h * 60 } : d)).sort((a, b) => a.startMinute - b.startMinute) })); }} />
                </label>
                <label className="field">Band name<input type="text" value={clock.name} onChange={(e) => setClock((c) => ({ ...c, name: e.target.value }))} /></label>
                <div className="grow" />
                <button className="btn sm danger" onClick={() => { removeBand(channel.id, channel.dayparts.indexOf(band)); setBandIdx(0); }}>Remove band</button>
              </div>
            )}
            <p className="muted small" style={{ marginBottom: 0 }}>Each band runs its own format and shows until the next band starts. The sections below edit the selected band.</p>
          </Card>

          {clock ? (
            <>
              <Card title="Shows" help={HELP.shows} summary={programPool ? `${showCount} shows · ${MODES.find((m) => m.v === programPool.selection)?.label.toLowerCase()}` : 'none'}>
                <PoolSlot role="program" poolId={clock.program.poolId} channelId={channel.id} onPick={pickPool('program')} />
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
              <Card title="Breaks" help={HELP.breaks} summary={[clock.breaks.poolId && 'ads', clock.networkId.enabled && clock.networkId.poolId && 'IDs', clock.pad.poolId && 'filler'].filter(Boolean).join(' · ') || 'nothing'} open={false}>
                <div className="recipe" style={{ gap: 16 }}>
                  {(['commercial', 'network-id', 'filler'] as Role[]).map((role) => (
                    <div key={role}>
                      <h3 style={{ marginBottom: 6 }}>{ROLE_LABEL[role]}</h3>
                      <PoolSlot role={role} poolId={role === 'commercial' ? clock.breaks.poolId : role === 'network-id' ? clock.networkId.poolId : clock.pad.poolId} channelId={channel.id} onPick={pickPool(role)} />
                    </div>
                  ))}
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
          </Card>

          <div className="toolbar">
            <button className="btn primary sm" onClick={() => setStatus(exportDay(channel, ruleset, previewDate))}>Export {previewDate}</button>
            <button className="btn sm" onClick={() => nav(`/channels/${duplicateChannel(channel.id)}`)}>Duplicate</button>
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

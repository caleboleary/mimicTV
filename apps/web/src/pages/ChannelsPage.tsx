import { useMemo, useState } from 'react';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from '@mimictv/core/schema/playout';
import {
  blocksInWindow, simulate, toPlayout, playoutFileName, programmesFor, toXmltv, DAY, fmtClock, defaultAnchorMs, type Channel,
} from '@mimictv/core';
import { useStore, dateStart } from '../store/store';
import { useRuleset } from '../store/useSim';

function download(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function ChannelsPage() {
  const channels = useStore((s) => s.channels);
  const clocks = useStore((s) => s.clocks);
  const previewDate = useStore((s) => s.previewDate);
  const updateChannel = useStore((s) => s.updateChannel);
  const addChannel = useStore((s) => s.addChannel);
  const removeChannel = useStore((s) => s.removeChannel);
  const ruleset = useRuleset();
  const [status, setStatus] = useState<Record<string, string>>({});
  const [showLineup, setShowLineup] = useState(false);

  const validate = useMemo(() => { const ajv = new Ajv2020({ strict: false }); addFormats(ajv); return ajv.compile(schema); }, []);

  const create = () => {
    const n = channels.length + 1;
    addChannel({
      id: `ch-${Date.now().toString(36)}`, number: String(n), name: `Channel ${n}`, tvgId: `mimic.${n}`, group: 'mimicTV',
      dayparts: clocks[0] ? [{ startMinute: 0, clockId: clocks[0].id }] : [], anchorMs: defaultAnchorMs(), seed: `ch-${Date.now().toString(36)}`,
    });
  };

  const duplicate = (ch: Channel) => {
    const copy: Channel = structuredClone(ch);
    copy.id = `ch-${Date.now().toString(36)}`;
    copy.number = String(Math.max(...channels.map((c) => Number(c.number) || 0)) + 1);
    copy.name = `${ch.name} (copy)`;
    copy.tvgId = `mimic.${copy.id}`;
    copy.seed = copy.id;
    addChannel(copy);
  };

  const exportDay = (ch: Channel) => {
    const dayStart = dateStart(previewDate), dayEnd = dayStart + DAY;
    const sim = simulate(ch, ruleset, Math.max(dayEnd, ch.anchorMs + DAY));
    const blocks = blocksInWindow(sim, dayStart, dayEnd);
    if (blocks.length === 0) { setStatus((s) => ({ ...s, [ch.id]: 'Nothing scheduled that day' })); return; }
    const playout = toPlayout(blocks, { clocks: ruleset.clocks });
    const ok = validate(playout);
    const start = blocks[0]!.start, finish = blocks[blocks.length - 1]!.end;
    download(playoutFileName(start, finish), JSON.stringify(playout, null, 2));
    download(`${ch.tvgId}.xml`, toXmltv(ch, programmesFor(blocks, ruleset.library)), 'application/xml');
    setStatus((s) => ({ ...s, [ch.id]: ok ? `✓ ${playout.items.length} items, valid against schema 0.0.3` : `✗ schema errors: ${JSON.stringify(validate.errors?.slice(0, 2))}` }));
  };

  const lineup = {
    server: { bind_address: '0.0.0.0', port: 8409 },
    output: { folder: '/tmp/hls' },
    xmltv: { folder: './xmltv' },
    channels: channels.map((c) => ({ number: c.number, name: c.name, config: `./channels/${c.id}/channel.json`, tvg_id: c.tvgId, logo: c.logo, group: c.group })),
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Channels</h1>
        <div className="grow" />
        <button className="btn sm" onClick={create}>New</button>
        <button className="btn sm" onClick={() => setShowLineup((v) => !v)}>{showLineup ? 'Hide' : 'Show'} lineup.json</button>
      </div>
      {channels.length === 0 && <div className="empty">No channels yet. A channel is a number, a name, and which clock runs at which time of day. {clocks.length === 0 ? 'Create a clock first.' : ''}</div>}
      {showLineup && <pre className="code" style={{ marginBottom: 14 }}>{JSON.stringify(lineup, null, 2)}</pre>}
      <div className="channel-cards">
        {channels.map((ch) => (
          <div className="panel" key={ch.id}>
            <div className="toolbar" style={{ marginBottom: 10 }}>
              <div className="chan-num">{ch.number}</div>
              <input type="text" value={ch.name} onChange={(e) => updateChannel(ch.id, (c) => ({ ...c, name: e.target.value }))} style={{ fontSize: 16, fontWeight: 600, flex: 1 }} />
            </div>
            <div className="form-grid">
              <label className="field">Number<input type="text" value={ch.number} onChange={(e) => updateChannel(ch.id, (c) => ({ ...c, number: e.target.value }))} /></label>
              <label className="field">tvg_id<input type="text" value={ch.tvgId} onChange={(e) => updateChannel(ch.id, (c) => ({ ...c, tvgId: e.target.value }))} /></label>
              <label className="field">Group<input type="text" value={ch.group ?? ''} onChange={(e) => updateChannel(ch.id, (c) => ({ ...c, group: e.target.value }))} /></label>
            </div>
            <div className="section">
              <h3>Dayparts</h3>
              {ch.dayparts.map((d, i) => (
                <div key={i} className="toolbar" style={{ marginBottom: 6 }}>
                  <input type="number" min={0} max={23} value={Math.floor(d.startMinute / 60)} onChange={(e) => updateChannel(ch.id, (c) => ({ ...c, dayparts: c.dayparts.map((x, j) => (j === i ? { ...x, startMinute: Number(e.target.value) * 60 } : x)).sort((a, b) => a.startMinute - b.startMinute) }))} />
                  <span className="mono muted">:00</span>
                  <select value={d.clockId} onChange={(e) => updateChannel(ch.id, (c) => ({ ...c, dayparts: c.dayparts.map((x, j) => (j === i ? { ...x, clockId: e.target.value } : x)) }))}>
                    {clocks.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </select>
                  {ch.dayparts.length > 1 && <button className="btn sm" onClick={() => updateChannel(ch.id, (c) => ({ ...c, dayparts: c.dayparts.filter((_, j) => j !== i) }))}>×</button>}
                </div>
              ))}
              {clocks.length > 0
                ? <button className="btn sm" onClick={() => updateChannel(ch.id, (c) => ({ ...c, dayparts: [...c.dayparts, { startMinute: 20 * 60, clockId: clocks[0]!.id }].sort((a, b) => a.startMinute - b.startMinute) }))}>+ daypart</button>
                : <span className="badge warn">no clocks yet</span>}
            </div>
            <div className="section toolbar">
              <button className="btn primary sm" onClick={() => exportDay(ch)}>Export {previewDate}</button>
              <button className="btn sm" onClick={() => duplicate(ch)}>Duplicate</button>
              <div className="grow" />
              <button className="btn sm danger" onClick={() => { if (confirm('Delete channel?')) removeChannel(ch.id); }}>Delete</button>
            </div>
            {status[ch.id] && <div className="small" style={{ marginTop: 8, color: status[ch.id]!.startsWith('✓') ? 'var(--ok)' : 'var(--warn)' }}>{status[ch.id]}</div>}
            <div className="small muted" style={{ marginTop: 8 }}>Timeline anchored {new Date(ch.anchorMs).toLocaleDateString()} {fmtClock(ch.anchorMs)} · seed <code>{ch.seed}</code></div>
          </div>
        ))}
      </div>
    </div>
  );
}

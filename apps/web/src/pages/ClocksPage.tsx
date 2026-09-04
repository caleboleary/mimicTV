import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { blocksInWindow, DAY, MIN, SEC, type Clock } from '@mimictv/core';
import { useStore, dateStart } from '../store/store';
import { useSim } from '../store/useSim';
import ClockDiagram from '../components/ClockDiagram';
import HourLanes from '../components/HourLanes';

export default function ClocksPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const clocks = useStore((s) => s.clocks);
  const pools = useStore((s) => s.pools);
  const channels = useStore((s) => s.channels);
  const previewDate = useStore((s) => s.previewDate);
  const updateClock = useStore((s) => s.updateClock);
  const addClock = useStore((s) => s.addClock);
  const removeClock = useStore((s) => s.removeClock);

  const clock = clocks.find((c) => c.id === id) ?? clocks[0];
  // Preview against the first channel that uses this clock.
  const channel = channels.find((ch) => ch.dayparts.some((d) => d.clockId === clock?.id));
  const sim = useSim(channel);
  const dayStart = dateStart(previewDate);
  const blocks = useMemo(() => (sim ? blocksInWindow(sim, dayStart, dayStart + DAY) : []), [sim, dayStart]);
  const sample = blocks.find((b) => b.clockId === clock?.id && b.breaks.length > 1) ?? blocks.find((b) => b.clockId === clock?.id);

  const programPools = pools.filter((p) => p.filter.kinds?.includes('episode') || p.filter.kinds?.includes('movie') || !p.filter.kinds);
  const interPools = pools.filter((p) => !p.filter.kinds?.includes('episode'));

  const set = (patch: (c: Clock) => Clock) => clock && updateClock(clock.id, patch);
  const minutes = (ms: number) => Math.round((ms / MIN) * 10) / 10;

  const create = () => {
    const c: Clock = {
      id: `clock-${Date.now().toString(36)}`, name: 'New clock',
      program: { poolId: programPools[0]?.id ?? '', targetMs: 22 * MIN, toleranceMs: 4 * MIN, allowMultiple: true },
      breaks: { atChapters: true, poolId: interPools[0]?.id ?? '', equalize: true, midTargetMs: 2 * MIN, maxItems: 0 },
      networkId: { enabled: false, poolId: interPools[0]?.id ?? '', nearMinutes: [0, 30], windowMs: 3 * MIN },
      pad: { toMinutes: 30, poolId: interPools[0]?.id ?? '' },
    };
    addClock(c);
    nav(`/clocks/${c.id}`);
  };

  const duplicate = () => {
    if (!clock) return;
    const copy: Clock = structuredClone(clock);
    copy.id = `clock-${Date.now().toString(36)}`;
    copy.name = `${clock.name} (copy)`;
    addClock(copy);
    nav(`/clocks/${copy.id}`);
  };

  return (
    <div className="split-narrow">
      <div>
        <div className="toolbar"><h1>Clocks</h1><div className="grow" /><button className="btn sm" onClick={create}>New</button>{clock && <button className="btn sm" onClick={duplicate}>Duplicate</button>}</div>
        {clocks.length === 0 && <div className="empty">No clocks yet. Make a pool first, then create a clock that draws from it.</div>}
        <div className="list">
          {clocks.map((c) => (
            <button key={c.id} className={`row${c.id === clock?.id ? ' active' : ''}`} onClick={() => nav(`/clocks/${c.id}`)}>
              {c.name}
              <span className="sub">{minutes(c.program.targetMs)} min · pad to :{c.pad.toMinutes} · {c.breaks.atChapters ? 'breaks at chapters' : 'no mid-rolls'}</span>
            </button>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 16 }}>
          A clock is the format for one program slot: how much content, where breaks go, what fills them, and how the slot pads out to the next boundary.
        </p>
      </div>

      {clock && (
        <div>
          <div className="panel">
            <div className="toolbar" style={{ marginBottom: 10 }}>
              <input type="text" value={clock.name} onChange={(e) => set((c) => ({ ...c, name: e.target.value }))} style={{ fontSize: 18, fontWeight: 600, width: 320 }} />
              <div className="grow" />
              {channel ? <span className="small muted">sample from <b>{channel.name}</b>, {previewDate}</span> : <span className="badge warn">no channel uses this clock</span>}
              <button className="btn sm danger" onClick={() => { if (confirm('Delete this clock?')) { removeClock(clock.id); nav('/clocks'); } }}>Delete</button>
            </div>
            {sample ? <ClockDiagram block={sample} /> : <div className="empty">No sample block for this clock on the preview day.</div>}
          </div>

          <div className="panel">
            <div className="section" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
              <h3>Program slot</h3>
              <div className="form-grid">
                <label className="field">Pool
                  <select value={clock.program.poolId} onChange={(e) => set((c) => ({ ...c, program: { ...c.program, poolId: e.target.value } }))}>
                    {!programPools.some((p) => p.id === clock.program.poolId) && <option value="">— pick a pool —</option>}
                    {programPools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="field">Target (min)
                  <input type="number" step={0.5} value={minutes(clock.program.targetMs)} onChange={(e) => set((c) => ({ ...c, program: { ...c.program, targetMs: Number(e.target.value) * MIN } }))} />
                </label>
                <label className="field">Tolerance (min)
                  <input type="number" step={0.5} value={minutes(clock.program.toleranceMs)} onChange={(e) => set((c) => ({ ...c, program: { ...c.program, toleranceMs: Number(e.target.value) * MIN } }))} />
                </label>
                <label className="check field" style={{ alignSelf: 'end' }}>
                  <input type="checkbox" checked={clock.program.allowMultiple} onChange={(e) => set((c) => ({ ...c, program: { ...c.program, allowMultiple: e.target.checked } }))} />
                  Stack programs to reach target (two 11s = one 22)
                </label>
              </div>
            </div>

            <div className="section">
              <h3>Breaks</h3>
              <div className="form-grid">
                <label className="check field">
                  <input type="checkbox" checked={clock.breaks.atChapters} onChange={(e) => set((c) => ({ ...c, breaks: { ...c.breaks, atChapters: e.target.checked } }))} />
                  Mid-roll at every chapter / break point
                </label>
                <label className="field">Commercial pool
                  <select value={clock.breaks.poolId} onChange={(e) => set((c) => ({ ...c, breaks: { ...c.breaks, poolId: e.target.value } }))}>
                    {!interPools.some((p) => p.id === clock.breaks.poolId) && <option value="">— none —</option>}
                    {interPools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="check field">
                  <input type="checkbox" checked={clock.breaks.equalize} onChange={(e) => set((c) => ({ ...c, breaks: { ...c.breaks, equalize: e.target.checked } }))} />
                  Equalize break lengths
                </label>
                <label className="field">Mid-roll target (sec, when not equalizing)
                  <input type="number" step={5} disabled={clock.breaks.equalize} value={Math.round(clock.breaks.midTargetMs / SEC)} onChange={(e) => set((c) => ({ ...c, breaks: { ...c.breaks, midTargetMs: Number(e.target.value) * SEC } }))} />
                </label>
                <label className="field">Max commercials per break (0 = no limit)
                  <input type="number" value={clock.breaks.maxItems} onChange={(e) => set((c) => ({ ...c, breaks: { ...c.breaks, maxItems: Number(e.target.value) } }))} />
                </label>
              </div>
            </div>

            <div className="section">
              <h3>Network ID</h3>
              <div className="form-grid">
                <label className="check field">
                  <input type="checkbox" checked={clock.networkId.enabled} onChange={(e) => set((c) => ({ ...c, networkId: { ...c.networkId, enabled: e.target.checked } }))} />
                  Play an ID last when a break ends near a boundary
                </label>
                <label className="field">ID pool
                  <select value={clock.networkId.poolId} onChange={(e) => set((c) => ({ ...c, networkId: { ...c.networkId, poolId: e.target.value } }))}>
                    {!interPools.some((p) => p.id === clock.networkId.poolId) && <option value="">— none —</option>}
                    {interPools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="field">Boundaries (minutes past hour)
                  <input type="text" value={clock.networkId.nearMinutes.join(', ')} onChange={(e) => set((c) => ({ ...c, networkId: { ...c.networkId, nearMinutes: e.target.value.split(',').map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)) } }))} />
                </label>
                <label className="field">Window (min)
                  <input type="number" step={0.5} value={minutes(clock.networkId.windowMs)} onChange={(e) => set((c) => ({ ...c, networkId: { ...c.networkId, windowMs: Number(e.target.value) * MIN } }))} />
                </label>
              </div>
            </div>

            <div className="section">
              <h3>Pad</h3>
              <div className="form-grid">
                <label className="field">Pad each slot to the next
                  <select value={clock.pad.toMinutes} onChange={(e) => set((c) => ({ ...c, pad: { ...c.pad, toMinutes: Number(e.target.value) } }))}>
                    {[15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                  </select>
                </label>
                <label className="field">Filler pool
                  <select value={clock.pad.poolId} onChange={(e) => set((c) => ({ ...c, pad: { ...c.pad, poolId: e.target.value } }))}>
                    {!interPools.some((p) => p.id === clock.pad.poolId) && <option value="">— none —</option>}
                    {interPools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="check field">
                  <input type="checkbox" checked={!!clock.bug} onChange={(e) => set((c) => ({ ...c, bug: e.target.checked ? { path: '/media/branding/bug.png', hideDuringBreaks: true } : undefined }))} />
                  Channel bug on programs (hidden during breaks)
                </label>
              </div>
            </div>
          </div>

          {channel && (
            <div className="panel">
              <h3 style={{ marginBottom: 10 }}>Day re-flow · {channel.name} · {previewDate}</h3>
              <HourLanes dayStart={dayStart} blocks={blocks} compact />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

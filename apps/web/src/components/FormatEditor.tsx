import { MIN, SEC, type BreakFallback, type Clock } from '@mimictv/core';

interface Props { clock: Clock; onChange: (patch: (c: Clock) => Clock) => void }

export default function FormatEditor({ clock, onChange: set }: Props) {
  const minutes = (ms: number) => Math.round((ms / MIN) * 10) / 10;
  const fb: BreakFallback = clock.breaks.fallback ?? { mode: 'none' };
  const setFallback = (mode: BreakFallback['mode']) => set((c) => ({
    ...c,
    breaks: { ...c.breaks, fallback: mode === 'none' ? { mode } : mode === 'interval' ? { mode, everyMs: 11 * MIN } : { mode, offsetsMs: [9 * MIN, 20 * MIN, 32 * MIN] } },
  }));
  return (
    <div className="recipe" style={{ gap: 14 }}>
      <div>
        <h3 style={{ marginBottom: 8 }}>Slot</h3>
        <div className="form-grid">
          <label className="field">Content target (min)
            <input type="number" step={0.5} value={minutes(clock.program.targetMs)} onChange={(e) => set((c) => ({ ...c, program: { ...c.program, targetMs: Number(e.target.value) * MIN } }))} />
          </label>
          <label className="field">Tolerance (min)
            <input type="number" step={0.5} value={minutes(clock.program.toleranceMs)} onChange={(e) => set((c) => ({ ...c, program: { ...c.program, toleranceMs: Number(e.target.value) * MIN } }))} />
          </label>
          <label className="field">Pad each slot to the next
            <select value={clock.pad.toMinutes} onChange={(e) => set((c) => ({ ...c, pad: { ...c.pad, toMinutes: Number(e.target.value) } }))}>
              {[15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </label>
          <label className="check field" style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={clock.program.allowMultiple} onChange={(e) => set((c) => ({ ...c, program: { ...c.program, allowMultiple: e.target.checked } }))} />
            Stack shorts to fill the slot (two 11s = one 22)
          </label>
        </div>
      </div>
      <div>
        <h3 style={{ marginBottom: 8 }}>Breaks</h3>
        <div className="form-grid">
          <label className="check field">
            <input type="checkbox" checked={clock.breaks.atChapters} onChange={(e) => set((c) => ({ ...c, breaks: { ...c.breaks, atChapters: e.target.checked } }))} />
            Use an episode's own break points (chapters) when it has them
          </label>
          <label className="field">{clock.breaks.atChapters ? 'When an episode has no break points' : 'Cut episodes'}
            <select value={fb.mode} onChange={(e) => setFallback(e.target.value as BreakFallback['mode'])}>
              <option value="none">{clock.breaks.atChapters ? 'no mid-rolls, one break after' : 'never: one break after each episode'}</option>
              <option value="interval">every N minutes</option>
              <option value="offsets">at these minutes into the episode</option>
            </select>
          </label>
          {fb.mode === 'interval' && (
            <label className="field">Every (min)
              <input type="number" min={1} step={0.5} value={minutes(fb.everyMs)} onChange={(e) => set((c) => ({ ...c, breaks: { ...c.breaks, fallback: { mode: 'interval', everyMs: Math.max(1, Number(e.target.value)) * MIN } } }))} />
            </label>
          )}
          {fb.mode === 'offsets' && (
            <label className="field">Minutes into the episode (comma separated)
              <input type="text" placeholder="e.g. 9, 20, 32" defaultValue={fb.offsetsMs.map((ms) => minutes(ms)).join(', ')}
                onBlur={(e) => set((c) => ({ ...c, breaks: { ...c.breaks, fallback: { mode: 'offsets', offsetsMs: e.target.value.split(',').map((x) => Number(x.trim())).filter((n) => n > 0).map((n) => n * MIN) } } }))} />
            </label>
          )}
          <label className="check field">
            <input type="checkbox" checked={clock.breaks.equalize} onChange={(e) => set((c) => ({ ...c, breaks: { ...c.breaks, equalize: e.target.checked } }))} />
            Equalize break lengths
          </label>
          <label className="field">Mid-roll length (sec, when not equalizing)
            <input type="number" step={5} disabled={clock.breaks.equalize} value={Math.round(clock.breaks.midTargetMs / SEC)} onChange={(e) => set((c) => ({ ...c, breaks: { ...c.breaks, midTargetMs: Number(e.target.value) * SEC } }))} />
          </label>
          <label className="field">Max ads per break (0 = no limit)
            <input type="number" value={clock.breaks.maxItems} onChange={(e) => set((c) => ({ ...c, breaks: { ...c.breaks, maxItems: Number(e.target.value) } }))} />
          </label>
          <label className="field">Ignore break points leaving a segment under (min)
            <input type="number" step={0.5} value={minutes(clock.breaks.minSegmentMs ?? 3 * MIN)} onChange={(e) => set((c) => ({ ...c, breaks: { ...c.breaks, minSegmentMs: Number(e.target.value) * MIN } }))} />
          </label>
        </div>
      </div>
      <div>
        <h3 style={{ marginBottom: 8 }}>Network ID</h3>
        <div className="form-grid">
          <label className="check field">
            <input type="checkbox" checked={clock.networkId.enabled} onChange={(e) => set((c) => ({ ...c, networkId: { ...c.networkId, enabled: e.target.checked } }))} />
            Play an ID last when a break ends near a boundary
          </label>
          <label className="field">Boundaries (minutes past the hour)
            <input type="text" value={clock.networkId.nearMinutes.join(', ')} onChange={(e) => set((c) => ({ ...c, networkId: { ...c.networkId, nearMinutes: e.target.value.split(',').map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)) } }))} />
          </label>
          <label className="field">Within (min)
            <input type="number" step={0.5} value={minutes(clock.networkId.windowMs)} onChange={(e) => set((c) => ({ ...c, networkId: { ...c.networkId, windowMs: Number(e.target.value) * MIN } }))} />
          </label>
        </div>
      </div>
      <div>
        <h3 style={{ marginBottom: 8 }}>Branding</h3>
        <label className="check field">
          <input type="checkbox" checked={!!clock.bug} onChange={(e) => set((c) => ({ ...c, bug: e.target.checked ? { path: '/media/branding/bug.png', hideDuringBreaks: true } : undefined }))} />
          Channel bug on programs, hidden during breaks
        </label>
        {clock.bug && <input type="text" value={clock.bug.path} onChange={(e) => set((c) => ({ ...c, bug: { ...c.bug!, path: e.target.value } }))} style={{ width: '100%', marginTop: 6 }} />}
      </div>
    </div>
  );
}

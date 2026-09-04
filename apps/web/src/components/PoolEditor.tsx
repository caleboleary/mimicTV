import { useMemo } from 'react';
import { poolItems, fmtDuration, MIN, type Library, type MediaKind, type Pool, type SelectionMode } from '@mimictv/core';
import ShowPicker from './ShowPicker';

const KINDS: MediaKind[] = ['episode', 'movie', 'commercial', 'network-id', 'filler'];
export const MODES: { v: SelectionMode; label: string }[] = [
  { v: 'shows-shuffled-episodes-in-order', label: 'Shuffle shows, episodes in order' },
  { v: 'sequential', label: 'Sequential' },
  { v: 'random', label: 'Random (with no-repeat window)' },
  { v: 'shuffle', label: 'Shuffle (play everything before repeating)' },
];
const SKIP = ['unnumbered', 'special', 'extra'];

interface Props {
  pool: Pool;
  library: Library;
  onChange: (patch: (p: Pool) => Pool) => void;
  /** program: shows + order. interstitial: tags + order. full: everything incl. kinds and name. */
  mode: 'program' | 'interstitial' | 'full';
}

export default function PoolEditor({ pool, library, onChange, mode }: Props) {
  const isProgram = mode === 'program' || (mode === 'full' && (pool.filter.kinds?.includes('episode') ?? false));
  const allTags = useMemo(() => [...new Set(library.items.flatMap((i) => i.tags))].filter((t) => !KINDS.includes(t as MediaKind) && !SKIP.includes(t)).sort(), [library]);
  const count = useMemo(() => poolItems(pool, library).length, [pool, library]);
  const set = onChange;
  return (
    <div className="recipe" style={{ gap: 10 }}>
      {mode === 'full' && (
        <div className="form-grid">
          <label className="field">Name<input type="text" value={pool.name} onChange={(e) => set((p) => ({ ...p, name: e.target.value }))} /></label>
          <label className="field">Kinds
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {KINDS.map((k) => { const on = pool.filter.kinds?.includes(k) ?? false; return <button key={k} className={`chip${on ? ' on' : ''}`} onClick={() => set((p) => ({ ...p, filter: { ...p.filter, kinds: on ? (p.filter.kinds ?? []).filter((x) => x !== k) : [...(p.filter.kinds ?? []), k] } }))}>{k}</button>; })}
            </div>
          </label>
        </div>
      )}
      <div className="form-grid">
        <label className="field">Pick order
          <select value={pool.selection} onChange={(e) => set((p) => ({ ...p, selection: e.target.value as SelectionMode }))}>
            {MODES.filter((m) => isProgram || m.v !== 'shows-shuffled-episodes-in-order').map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
          </select>
        </label>
        {pool.selection === 'random' && (
          <label className="field">No repeat within (min)
            <input type="number" value={Math.round((pool.noRepeatMs ?? 0) / MIN)} onChange={(e) => set((p) => ({ ...p, noRepeatMs: Number(e.target.value) * MIN }))} />
          </label>
        )}
        {isProgram && (
          <label className="check field" style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={pool.filter.excludeTags?.some((t) => SKIP.includes(t)) ?? false}
              onChange={(e) => set((p) => ({ ...p, filter: { ...p.filter, excludeTags: e.target.checked ? [...new Set([...(p.filter.excludeTags ?? []), ...SKIP])] : (p.filter.excludeTags ?? []).filter((t) => !SKIP.includes(t)) } }))} />
            Skip extras, specials, unnumbered files
          </label>
        )}
      </div>
      {isProgram && <ShowPicker library={library} selected={pool.filter.showIds ?? []} onChange={(ids) => set((p) => ({ ...p, filter: { ...p.filter, showIds: ids } }))} />}
      {!isProgram && allTags.length > 0 && (
        <label className="field">Only items tagged (all must match)
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {allTags.map((t) => { const on = pool.filter.tags?.includes(t) ?? false; return <button key={t} className={`chip${on ? ' on' : ''}`} onClick={() => set((p) => ({ ...p, filter: { ...p.filter, tags: on ? (p.filter.tags ?? []).filter((x) => x !== t) : [...(p.filter.tags ?? []), t] } }))}>{t}</button>; })}
          </div>
        </label>
      )}
      <div className="muted small">{count} items match{count > 0 ? ` · ${fmtDuration(poolItems(pool, library).reduce((n, i) => n + i.durationMs, 0))} total` : ''}</div>
    </div>
  );
}

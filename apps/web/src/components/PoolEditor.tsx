import { useMemo, useState } from 'react';
import { poolItems, libraryFolders, termsMatch, fmtDuration, MIN, type FilterTerms, type Library, type MediaKind, type Pool, type SelectionMode } from '@mimictv/core';
import ShowPicker from './ShowPicker';
import { Disclosure } from './Card';

const KINDS: MediaKind[] = ['episode', 'movie', 'commercial', 'network-id', 'bumper', 'filler'];
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
  /** program: shows + order. interstitial: searches + order. full: everything incl. kinds and name. */
  mode: 'program' | 'interstitial' | 'full';
}

/** Saved searches, OR'd together: "text" in "folder". */
function SearchRows({ pool, library, onChange: set }: Omit<Props, 'mode'>) {
  const rows = pool.filter.any ?? [];
  const { any: _ignored, ...scope } = pool.filter;
  const folders = useMemo(() => libraryFolders(library, scope), [library, pool.filter]);
  const scoped = useMemo(() => library.items.filter((i) => termsMatch(i, scope)), [library, pool.filter]);
  const update = (i: number, patch: Partial<FilterTerms>) => set((p) => ({ ...p, filter: { ...p.filter, any: (p.filter.any ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r)) } }));
  const remove = (i: number) => set((p) => ({ ...p, filter: { ...p.filter, any: (p.filter.any ?? []).filter((_, j) => j !== i) } }));
  const add = () => set((p) => ({ ...p, filter: { ...p.filter, any: [...(p.filter.any ?? []), { text: '', folder: '' }] } }));
  return (
    <div className="field">
      <span>Saved searches {rows.length > 1 ? '(an item matches if any row matches)' : ''}</span>
      {rows.length === 0 && <div className="muted small">No searches: everything in scope is included. Add one to narrow it down, e.g. "nike" in the commercials folder.</div>}
      <div className="search-rows">
        {rows.map((r, i) => {
          const n = scoped.filter((it) => termsMatch(it, r)).length;
          return (
            <div className="search-row" key={i}>
              <input type="text" placeholder="search text…" value={r.text ?? ''} onChange={(e) => update(i, { text: e.target.value })} />
              <span className="muted small">in</span>
              <select value={r.folder ?? ''} onChange={(e) => update(i, { folder: e.target.value })}>
                <option value="">any folder</option>
                {folders.map((f) => <option key={f.path} value={f.path}>{'  '.repeat(Math.max(0, f.depth - 2))}{f.path.split('/').pop()} · {f.count}</option>)}
              </select>
              <span className={`badge${n === 0 ? ' warn' : ''}`}>{n}</span>
              <button className="btn sm" title="Remove this search" onClick={() => remove(i)}>×</button>
            </div>
          );
        })}
      </div>
      <div><button className="btn sm" onClick={add}>+ add search</button></div>
    </div>
  );
}

function Matches({ pool, library }: { pool: Pool; library: Library }) {
  const [open, setOpen] = useState(false);
  const items = useMemo(() => poolItems(pool, library), [pool, library]);
  const total = items.reduce((n, i) => n + i.durationMs, 0);
  return (
    <div>
      <button className="btn sm" onClick={() => setOpen((v) => !v)} style={{ marginBottom: open ? 8 : 0 }}>
        {items.length} items match{items.length > 0 ? ` · ${fmtDuration(total)} total` : ''} {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="matches">
          {items.length === 0 && <div className="muted small">Nothing matches. Loosen a search or the scope above.</div>}
          {items.slice(0, 60).map((i) => (
            <div className="match" key={i.id}>
              <span>{i.title}</span>
              <span className="muted small mono">{i.durationMs ? fmtDuration(i.durationMs) : 'any'}</span>
              <span className="muted small path" title={i.path}>{i.path.split('/').slice(-3, -1).join('/')}</span>
            </div>
          ))}
          {items.length > 60 && <div className="muted small">…and {items.length - 60} more</div>}
        </div>
      )}
    </div>
  );
}

export default function PoolEditor({ pool, library, onChange, mode }: Props) {
  const isProgram = mode === 'program' || (mode === 'full' && (pool.filter.kinds?.includes('episode') ?? false));
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
      {isProgram && <ShowPicker library={library} selected={pool.filter.showIds ?? []} onChange={(ids) => set((p) => ({ ...p, filter: { ...p.filter, showIds: ids } }))} />}
      {!isProgram && <SearchRows pool={pool} library={library} onChange={set} />}
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
        {!isProgram && (pool.selection === 'random' || pool.selection === 'shuffle') && (
          <label className="check field" style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={!!pool.noRepeatAcrossChannels} onChange={(e) => set((p) => ({ ...p, noRepeatAcrossChannels: e.target.checked || undefined }))} />
            Count plays on other channels too
          </label>
        )}
        {isProgram && pool.selection === 'shows-shuffled-episodes-in-order' && (
          <label className="field">Episodes of a show in a row
            <select value={pool.runLength ?? 1} onChange={(e) => set((p) => ({ ...p, runLength: Number(e.target.value) }))}>
              <option value={1}>one, then switch shows</option>
              {[2, 3, 4].map((n) => <option key={n} value={n}>{n} in a row, then switch</option>)}
            </select>
          </label>
        )}
      </div>
      {isProgram && (
        <Disclosure label="More options">
          <div className="form-grid">
            <label className="field">Only episodes between (min)
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="number" min={0} step={1} placeholder="any" value={pool.filter.minDurationMs != null ? Math.round(pool.filter.minDurationMs / MIN) : ''}
                  onChange={(e) => set((p) => ({ ...p, filter: { ...p.filter, minDurationMs: e.target.value === '' ? undefined : Number(e.target.value) * MIN } }))} />
                <span className="muted">and</span>
                <input type="number" min={0} step={1} placeholder="any" value={pool.filter.maxDurationMs != null ? Math.round(pool.filter.maxDurationMs / MIN) : ''}
                  onChange={(e) => set((p) => ({ ...p, filter: { ...p.filter, maxDurationMs: e.target.value === '' ? undefined : Number(e.target.value) * MIN } }))} />
              </div>
            </label>
            <label className="field">Only seasons
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="number" min={0} step={1} placeholder="first" value={pool.filter.seasons?.min ?? ''}
                  onChange={(e) => set((p) => ({ ...p, filter: { ...p.filter, seasons: { ...p.filter.seasons, min: e.target.value === '' ? undefined : Number(e.target.value) } } }))} />
                <span className="muted">to</span>
                <input type="number" min={0} step={1} placeholder="last" value={pool.filter.seasons?.max ?? ''}
                  onChange={(e) => set((p) => ({ ...p, filter: { ...p.filter, seasons: { ...p.filter.seasons, max: e.target.value === '' ? undefined : Number(e.target.value) } } }))} />
              </div>
            </label>
            <label className="check field" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={pool.filter.excludeTags?.some((t) => SKIP.includes(t)) ?? false}
                onChange={(e) => set((p) => ({ ...p, filter: { ...p.filter, excludeTags: e.target.checked ? [...new Set([...(p.filter.excludeTags ?? []), ...SKIP])] : (p.filter.excludeTags ?? []).filter((t) => !SKIP.includes(t)) } }))} />
              Skip extras, specials, unnumbered files
            </label>
          </div>
        </Disclosure>
      )}
      <Matches pool={pool} library={library} />
    </div>
  );
}

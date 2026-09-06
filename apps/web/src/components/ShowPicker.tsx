import { useMemo, useRef, useState } from 'react';
import type { Library } from '@mimictv/core';

interface Props { library: Library; selected: string[]; onChange: (ids: string[]) => void }

export default function ShowPicker({ library, selected, onChange }: Props) {
  const [q, setQ] = useState('');
  // Shows already picked when the editor opened sit at the top; a click never reorders the list, so you keep your place.
  const pinned = useRef(new Set(selected));
  const stats = useMemo(() => {
    const m = new Map<string, { eps: number; ch: number }>();
    for (const i of library.items) if (i.showId && i.kind === 'episode') {
      const s = m.get(i.showId) ?? { eps: 0, ch: 0 }; s.eps++; if (i.breakPoints.length) s.ch++; m.set(i.showId, s);
    }
    return m;
  }, [library]);
  const shows = useMemo(() => {
    const all = [...library.shows].sort((a, b) => a.title.localeCompare(b.title));
    const ql = q.trim().toLowerCase();
    const filtered = ql ? all.filter((s) => s.title.toLowerCase().includes(ql)) : all;
    return [...filtered.filter((s) => pinned.current.has(s.id)), ...filtered.filter((s) => !pinned.current.has(s.id))].slice(0, 90);
  }, [library, q]);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <input type="text" placeholder="filter shows…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
        <span className="muted small">{selected.length === 0 ? 'none selected = every show' : `${selected.length} selected`}</span>
        {selected.length > 0 && <button className="btn sm" onClick={() => onChange([])}>clear</button>}
      </div>
      <div className="chips" style={{ flexWrap: 'wrap' }}>
        {shows.map((s) => {
          const st = stats.get(s.id);
          const on = selected.includes(s.id);
          return (
            <button key={s.id} className={`chip${on ? ' on' : ''}`} onClick={() => toggle(s.id)}
              title={st ? `${st.eps} episodes · ${st.ch} with break points` : ''}>
              {s.title}{s.year ? <span className="muted"> {s.year}</span> : null}
              {st && st.ch === 0 ? <span title="no break points" style={{ color: 'var(--warn)' }}> ·</span> : null}
            </button>
          );
        })}
        {library.shows.length > 90 && shows.length === 90 && <span className="muted small">…filter to see more</span>}
      </div>
    </div>
  );
}

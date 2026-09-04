import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { poolItems, poolShows, fmtDuration, fmtClock, DAY, HOUR, MIN, type Pool, type MediaKind, type SelectionMode } from '@mimictv/core';
import { useStore, dateStart } from '../store/store';
import { useSelectedChannel, useSim } from '../store/useSim';

const KINDS: MediaKind[] = ['episode', 'movie', 'commercial', 'network-id', 'filler'];
const MODES: { v: SelectionMode; label: string }[] = [
  { v: 'shows-shuffled-episodes-in-order', label: 'Shuffle shows, episodes in order' },
  { v: 'sequential', label: 'Sequential' },
  { v: 'random', label: 'Random (with no-repeat window)' },
  { v: 'shuffle', label: 'Shuffle (play everything before repeating)' },
];

export default function PoolsPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const pools = useStore((s) => s.pools);
  const library = useStore((s) => s.library);
  const previewDate = useStore((s) => s.previewDate);
  const updatePool = useStore((s) => s.updatePool);
  const addPool = useStore((s) => s.addPool);
  const removePool = useStore((s) => s.removePool);
  const channel = useSelectedChannel();
  const sim = useSim(channel);

  const pool = pools.find((p) => p.id === id) ?? pools[0];
  const items = useMemo(() => (pool ? poolItems(pool, library) : []), [pool, library]);
  const shows = useMemo(() => (pool ? poolShows(pool, library) : []), [pool, library]);
  const dayEnd = dateStart(previewDate) + DAY;
  const [showFilter, setShowFilter] = useState('');
  const showChoices = useMemo(() => {
    const q = showFilter.trim().toLowerCase();
    const all = [...library.shows].sort((a, b) => a.title.localeCompare(b.title));
    return (q ? all.filter((s) => s.title.toLowerCase().includes(q)) : all).slice(0, 80);
  }, [library, showFilter]);
  const allTags = useMemo(() => [...new Set(library.items.flatMap((i) => i.tags))].sort(), [library]);

  // "As of the end of the preview day": last played + cursors + upcoming picks.
  const asOf = useMemo(() => {
    const lastPlayed = new Map<string, number>();
    const upcoming: { showId?: string; title: string; at: number; season?: number; episode?: number }[] = [];
    const cursor = new Map<string, number>();
    if (!sim || !pool) return { lastPlayed, upcoming, cursor };
    const poolIds = new Set(items.map((i) => i.id));
    for (const b of sim.blocks) for (const e of b.entries) {
      if (!poolIds.has(e.item.id)) continue;
      if (e.role === 'program' && e.partIndex !== 0) continue;
      if (e.start < dayEnd) lastPlayed.set(e.item.id, e.start);
      else if (e.role === 'program' && upcoming.length < 8) upcoming.push({ showId: e.item.showId, title: e.item.title, at: e.start, season: e.item.season, episode: e.item.episode });
    }
    for (const s of shows) {
      let next = 0;
      for (let i = 0; i < s.episodes.length; i++) if (lastPlayed.has(s.episodes[i]!.id)) next = (i + 1) % s.episodes.length;
      cursor.set(s.showId, next);
    }
    return { lastPlayed, upcoming, cursor };
  }, [sim, pool, items, shows, dayEnd]);

  const set = (patch: (p: Pool) => Pool) => pool && updatePool(pool.id, patch);
  const totalMs = items.reduce((n, i) => n + i.durationMs, 0);
  const withBreaks = items.filter((i) => i.kind === 'episode' && i.breakPoints.length > 0).length;
  const episodes = items.filter((i) => i.kind === 'episode').length;

  const create = () => {
    const hasEpisodes = library.items.some((i) => i.kind === 'episode');
    const p: Pool = hasEpisodes && !pools.some((x) => x.filter.kinds?.includes('episode'))
      ? { id: `pool-${Date.now().toString(36)}`, name: 'New pool', filter: { kinds: ['episode'], excludeTags: ['unnumbered', 'special', 'extra'] }, selection: 'shows-shuffled-episodes-in-order' }
      : { id: `pool-${Date.now().toString(36)}`, name: 'New pool', filter: { kinds: ['commercial'] }, selection: 'random', noRepeatMs: HOUR };
    addPool(p);
    nav(`/pools/${p.id}`);
  };

  return (
    <div className="split-narrow">
      <div>
        <div className="toolbar"><h1>Pools</h1><div className="grow" /><button className="btn sm" onClick={create}>New</button></div>
        {pools.length === 0 && <div className="empty">No pools yet. A pool is a slice of the library plus a pick order. Start with one for shows and one for commercials.</div>}
        <div className="list">
          {pools.map((p) => (
            <button key={p.id} className={`row${p.id === pool?.id ? ' active' : ''}`} onClick={() => nav(`/pools/${p.id}`)}>
              {p.name}
              <span className="sub">{poolItems(p, library).length} items · {MODES.find((m) => m.v === p.selection)?.label}</span>
            </button>
          ))}
        </div>
      </div>

      {pool && (
        <div>
          <div className="panel">
            <div className="toolbar" style={{ marginBottom: 10 }}>
              <input type="text" value={pool.name} onChange={(e) => set((p) => ({ ...p, name: e.target.value }))} style={{ fontSize: 18, fontWeight: 600, width: 320 }} />
              <div className="grow" />
              <div className="stats">
                <div className="stat"><b>{items.length}</b><span>items</span></div>
                <div className="stat"><b>{fmtDuration(totalMs)}</b><span>runtime</span></div>
                {episodes > 0 && <div className="stat"><b>{withBreaks}/{episodes}</b><span>have breaks</span></div>}
              </div>
              <button className="btn sm danger" onClick={() => { if (confirm('Delete this pool?')) { removePool(pool.id); nav('/pools'); } }}>Delete</button>
            </div>
            <div className="form-grid">
              <label className="field">Selection
                <select value={pool.selection} onChange={(e) => set((p) => ({ ...p, selection: e.target.value as SelectionMode }))}>
                  {MODES.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
                </select>
              </label>
              <label className="field">No repeat within (min)
                <input type="number" disabled={pool.selection !== 'random'} value={Math.round((pool.noRepeatMs ?? 0) / MIN)} onChange={(e) => set((p) => ({ ...p, noRepeatMs: Number(e.target.value) * MIN }))} />
              </label>
              <label className="field">Kinds
                <div className="chips" style={{ flexWrap: 'wrap' }}>
                  {KINDS.map((k) => {
                    const on = pool.filter.kinds?.includes(k) ?? false;
                    return <button key={k} className={`chip${on ? ' on' : ''}`} onClick={() => set((p) => ({ ...p, filter: { ...p.filter, kinds: on ? (p.filter.kinds ?? []).filter((x) => x !== k) : [...(p.filter.kinds ?? []), k] } }))}>{k}</button>;
                  })}
                </div>
              </label>
              {(pool.filter.kinds?.includes('episode') ?? false) && (
                <label className="field" style={{ gridColumn: '1 / -1' }}>Shows (none selected = every show matching kinds/tags)
                  <input type="text" placeholder="filter shows…" value={showFilter} onChange={(e) => setShowFilter(e.target.value)} style={{ width: 240 }} />
                  <div className="chips" style={{ flexWrap: 'wrap' }}>
                    {showChoices.map((sh) => {
                      const on = pool.filter.showIds?.includes(sh.id) ?? false;
                      return <button key={sh.id} className={`chip${on ? ' on' : ''}`} onClick={() => set((p) => ({ ...p, filter: { ...p.filter, showIds: on ? (p.filter.showIds ?? []).filter((x) => x !== sh.id) : [...(p.filter.showIds ?? []), sh.id] } }))}>{sh.title}</button>;
                    })}
                    {library.shows.length > 80 && showChoices.length === 80 && <span className="muted small">…filter to see more</span>}
                  </div>
                </label>
              )}
              {(pool.filter.kinds?.includes('episode') ?? false) && (
                <label className="check field">
                  <input type="checkbox" checked={pool.filter.excludeTags?.includes('unnumbered') ?? false}
                    onChange={(e) => set((p) => ({ ...p, filter: { ...p.filter, excludeTags: e.target.checked ? [...new Set([...(p.filter.excludeTags ?? []), 'unnumbered', 'special', 'extra'])] : (p.filter.excludeTags ?? []).filter((t) => !['unnumbered', 'special', 'extra'].includes(t)) } }))} />
                  Skip extras, season-0 specials, and files with no episode number
                </label>
              )}
              <label className="field">Tags (all must match)
                <div className="chips" style={{ flexWrap: 'wrap' }}>
                  {allTags.map((t) => {
                    const on = pool.filter.tags?.includes(t) ?? false;
                    return <button key={t} className={`chip${on ? ' on' : ''}`} onClick={() => set((p) => ({ ...p, filter: { ...p.filter, tags: on ? (p.filter.tags ?? []).filter((x) => x !== t) : [...(p.filter.tags ?? []), t] } }))}>{t}</button>;
                  })}
                </div>
              </label>
            </div>
          </div>

          {shows.length > 0 && (
            <div className="panel">
              <h3 style={{ marginBottom: 10 }}>Cursors · {channel?.name} · as of end of {previewDate}</h3>
              <div className="cursor-cards">
                {shows.map((s) => {
                  const show = library.shows.find((x) => x.id === s.showId);
                  const next = asOf.cursor.get(s.showId) ?? 0;
                  const ep = s.episodes[next]!;
                  return (
                    <div className="cursor-card" key={s.showId}>
                      <div><b>{show?.title ?? s.showId}</b> <span className="muted small">{s.episodes.length} eps</span></div>
                      <div className="bar"><i style={{ width: `${(next / s.episodes.length) * 100}%` }} /></div>
                      <div className="small">next: <span className="mono">S{String(ep.season).padStart(2, '0')}E{String(ep.episode).padStart(2, '0')}</span> {ep.title}</div>
                    </div>
                  );
                })}
              </div>
              {asOf.upcoming.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <h3 style={{ marginBottom: 6 }}>Next picks</h3>
                  <div className="small">
                    {asOf.upcoming.map((u, i) => (
                      <div key={i}><span className="mono muted">{new Date(u.at).toLocaleDateString(undefined, { weekday: 'short' })} {fmtClock(u.at)}</span> · {library.shows.find((x) => x.id === u.showId)?.title} S{String(u.season).padStart(2, '0')}E{String(u.episode).padStart(2, '0')} · {u.title}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead><tr><th>Title</th><th>Show</th><th className="mono">Length</th><th>Breaks</th><th>Last played</th></tr></thead>
              <tbody>
                {items.slice(0, 200).map((i) => {
                  const last = asOf.lastPlayed.get(i.id);
                  const show = i.showId ? library.shows.find((x) => x.id === i.showId) : undefined;
                  return (
                    <tr key={i.id}>
                      <td>{i.title}{i.trimmable && <span className="badge" style={{ marginLeft: 6 }}>trimmable</span>}</td>
                      <td className="muted">{show ? `${show.title} S${String(i.season).padStart(2, '0')}E${String(i.episode).padStart(2, '0')}` : i.tags.filter((t) => t !== i.kind).join(', ')}</td>
                      <td className="mono">{i.durationMs ? fmtDuration(i.durationMs) : 'any'}</td>
                      <td>{i.kind === 'episode' ? (i.breakPoints.length > 0 ? <span className="badge ok">{i.breakPoints.length} · {i.breakSource}</span> : <span className="badge warn">none</span>) : <span className="muted">—</span>}</td>
                      <td className="mono muted">{last != null ? `${new Date(last).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${fmtClock(last)}` : 'never'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {items.length > 200 && <div className="small muted" style={{ padding: 10 }}>Showing 200 of {items.length}.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

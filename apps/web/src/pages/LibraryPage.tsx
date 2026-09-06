import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  fmtDuration, poolItems, libraryFolders, hiddenBy, showFolder,
  type MediaKind, type Pool,
} from '@mimictv/core';
import { useStore, useLibrary } from '../store/store';
import PoolEditor, { MODES } from '../components/PoolEditor';

const KINDS: MediaKind[] = ['episode', 'movie', 'commercial', 'network-id', 'bumper', 'filler'];
type Tab = 'overview' | 'shows' | 'folders' | 'collections';


export default function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const setTab = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t });
  const library = useLibrary();
  const source = useStore((s) => s.librarySource);
  const eps = library.items.filter((i) => i.kind === 'episode');
  const withBreaks = eps.filter((i) => i.breakPoints.length > 0).length;

  return (
    <div>
      <div className="toolbar"><h1>Library</h1><div className="grow" /><span className="muted small">{source || 'no library yet'}</span></div>
      <div className="subtabs">
        {(['overview', 'shows', 'folders', 'collections'] as Tab[]).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>)}
      </div>
      {tab === 'overview' && <Overview withBreaks={withBreaks} eps={eps.length} />}
      {tab === 'shows' && <Shows />}
      {tab === 'folders' && <Folders />}
      {tab === 'collections' && <Collections />}
    </div>
  );
}

function Overview({ withBreaks, eps }: { withBreaks: number; eps: number }) {
  const library = useLibrary();
  const counts = KINDS.map((k) => [k, library.items.filter((i) => i.kind === k).length] as const);
  return (
    <>
      <div className="panel">
        <div className="stats">
          <div className="stat"><b>{library.shows.length}</b><span>shows</span></div>
          {counts.map(([k, n]) => <div className="stat" key={k}><b>{n}</b><span>{k}</span></div>)}
          <div className="stat"><b>{eps ? Math.round((withBreaks / eps) * 100) : 0}%</b><span>eps with breaks</span></div>
          <div className="stat"><b>{fmtDuration(library.items.reduce((n, i) => n + i.durationMs, 0))}</b><span>runtime</span></div>
        </div>
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <Link to="/setup" className="btn sm primary">Scan folders / rescan</Link>
          <span className="muted small">Set the folders once under Setup; rescan whenever files change. Channels keep their settings.</span>
        </div>
      </div>
    </>
  );
}

function Shows() {
  const library = useStore((s) => s.library);
  const hidden = useStore((s) => s.hiddenFolders);
  const hideFolder = useStore((s) => s.hideFolder);
  const unhideFolder = useStore((s) => s.unhideFolder);
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const m = new Map<string, { eps: number; ch: number; dur: number; seasons: Set<number> }>();
    for (const i of library.items) if (i.showId && i.kind === 'episode') {
      const r = m.get(i.showId) ?? { eps: 0, ch: 0, dur: 0, seasons: new Set<number>() };
      r.eps++; if (i.breakPoints.length) r.ch++; r.dur += i.durationMs; if (i.season != null) r.seasons.add(i.season); m.set(i.showId, r);
    }
    const ql = q.trim().toLowerCase();
    const all = [...library.shows].filter((s) => !ql || s.title.toLowerCase().includes(ql)).sort((a, b) => a.title.localeCompare(b.title)).map((s) => {
      const folder = showFolder(library, s.id);
      const eps = library.items.filter((i) => i.showId === s.id && i.kind === 'episode');
      const first = eps[0];
      const breaks = !first ? '' : eps.some((i) => i.breakSource === 'blackdetect' || i.breakSource === 'manual' || i.noBreaks) ? 'decided' : eps.some((i) => i.chaptersOurs) ? 'old tool' : eps.some((i) => i.breakSource === 'chapters') ? 'chapter data from files' : 'none';
      return { show: s, folder, breaksFolder: first ? first.path.split('/').slice(0, 4).join('/') : undefined, breaks, hiddenByFolder: folder ? hiddenBy(folder, hidden) : undefined, ...(m.get(s.id) ?? { eps: 0, ch: 0, dur: 0, seasons: new Set<number>() }) };
    });
    // Hidden shows sink to the bottom, greyed, with the way back next to them.
    return [...all.filter((r) => !r.hiddenByFolder), ...all.filter((r) => r.hiddenByFolder)];
  }, [library, hidden, q]);
  const hiddenCount = rows.filter((r) => r.hiddenByFolder).length;
  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="toolbar" style={{ padding: 12, marginBottom: 0 }}>
        <input type="text" placeholder="filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
        <span className="muted small">{rows.length - hiddenCount} shows{hiddenCount ? ` · ${hiddenCount} hidden` : ''}</span>
        <div className="grow" />
        <span className="muted small">Hidden shows stay out of every pool, preview, and publish until you show them again.</span>
      </div>
      <table>
        <thead><tr><th>Show</th><th className="mono">Eps</th><th className="mono">Seasons</th><th className="mono">Avg length</th><th>Break points</th><th>Breaks</th><th /></tr></thead>
        <tbody>
          {rows.map(({ show, folder, breaksFolder, breaks, hiddenByFolder, eps, ch, dur, seasons }, i) => (
            <tr key={show.id} className={hiddenByFolder ? 'hidden-row' : ''} style={hiddenByFolder && i > 0 && !rows[i - 1]!.hiddenByFolder ? { borderTop: '2px solid var(--line)' } : undefined}>
              <td>{show.title}{show.year ? <span className="muted"> ({show.year})</span> : null}{hiddenByFolder && <span className="sub muted mono">{hiddenByFolder}</span>}</td>
              <td className="mono">{eps}</td>
              <td className="mono">{seasons.size}</td>
              <td className="mono">{eps ? fmtDuration(dur / eps) : '—'}</td>
              <td><span className={`badge ${ch === eps && eps > 0 ? 'ok' : ch === 0 ? 'warn' : ''}`}>{ch}/{eps}</span></td>
              <td>{breaksFolder && <Link className={`badge ${breaks === 'decided' ? 'ok' : breaks === 'chapter data from files' ? 'warn' : ''}`} to={`/library/breaks?folder=${encodeURIComponent(breaksFolder)}`} title="Find, check, and lock in this show's ad breaks">{breaks} →</Link>}</td>
              <td style={{ textAlign: 'right' }}>
                {hiddenByFolder
                  ? <button className="btn sm" onClick={() => unhideFolder(hiddenByFolder)}>Show again</button>
                  : folder && <button className="btn sm" title={`Hide ${folder}`} onClick={() => hideFolder(folder)}>Hide</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Every folder the scan found, two levels under the roots, with hide/show. Hidden folders sink to the bottom. */
function Folders() {
  const library = useStore((s) => s.library);
  const hidden = useStore((s) => s.hiddenFolders);
  const hideFolder = useStore((s) => s.hideFolder);
  const unhideFolder = useStore((s) => s.unhideFolder);
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const kinds = new Map<string, Set<string>>();
    for (const i of library.items) { const parts = i.path.split(/[\\/]+/); for (let d = 3; d <= 4 && d < parts.length; d++) { const p = parts.slice(0, d).join('/'); kinds.set(p, (kinds.get(p) ?? new Set()).add(i.kind)); } }
    const ql = q.trim().toLowerCase();
    const all = libraryFolders(library).filter((f) => f.depth <= 3 && (!ql || f.path.toLowerCase().includes(ql))).map((f) => ({ ...f, kinds: [...(kinds.get(f.path) ?? [])], hiddenByFolder: hiddenBy(f.path, hidden) }));
    return [...all.filter((r) => !r.hiddenByFolder), ...all.filter((r) => r.hiddenByFolder)];
  }, [library, hidden, q]);
  const hiddenCount = rows.filter((r) => r.hiddenByFolder).length;
  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="toolbar" style={{ padding: 12, marginBottom: 0 }}>
        <input type="text" placeholder="filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
        <span className="muted small">{rows.length - hiddenCount} folders{hiddenCount ? ` · ${hiddenCount} hidden` : ''}</span>
        <div className="grow" />
        <span className="muted small">Hiding a folder hides everything under it. Rescans don't bring it back; "Show again" does.</span>
      </div>
      <table>
        <thead><tr><th>Folder</th><th>Holds</th><th className="mono">Files</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.path} className={r.hiddenByFolder ? 'hidden-row' : ''} style={r.hiddenByFolder && i > 0 && !rows[i - 1]!.hiddenByFolder ? { borderTop: '2px solid var(--line)' } : undefined}>
              <td className="mono" style={{ paddingLeft: r.depth === 3 ? 28 : undefined }}>{r.path}{r.hiddenByFolder && r.hiddenByFolder !== r.path && <span className="sub muted">via {r.hiddenByFolder}</span>}</td>
              <td>{r.kinds.map((k) => <span key={k} className="badge" style={{ marginRight: 4 }}>{k}</span>)}</td>
              <td className="mono">{r.count}</td>
              <td style={{ textAlign: 'right' }}>
                {r.hiddenByFolder
                  ? <button className="btn sm" onClick={() => unhideFolder(r.hiddenByFolder!)}>Show again</button>
                  : <button className="btn sm" onClick={() => hideFolder(r.path)}>Hide</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Collections() {
  const [params, setParams] = useSearchParams();
  const pools = useStore((s) => s.pools);
  const clocks = useStore((s) => s.clocks);
  const channels = useStore((s) => s.channels);
  const library = useLibrary();
  const updatePool = useStore((s) => s.updatePool);
  const addPool = useStore((s) => s.addPool);
  const removePool = useStore((s) => s.removePool);
  const shared = pools.filter((p) => !p.ownerChannelId);
  const selId = params.get('pool') ?? shared[0]?.id;
  const pool = shared.find((p) => p.id === selId);
  const select = (id: string) => setParams({ tab: 'collections', pool: id });
  const usedBy = (pid: string) => new Set(clocks.filter((c) => [c.program.poolId, c.breaks.poolId, c.networkId.poolId, c.pad.poolId].includes(pid)).flatMap((c) => channels.filter((ch) => ch.dayparts.some((d) => d.clockId === c.id)).map((ch) => ch.name))).size;
  const create = () => { const p: Pool = { id: `pool-${Date.now().toString(36)}`, name: 'New collection', filter: { kinds: ['commercial'] }, selection: 'random', noRepeatMs: 3600000 }; addPool(p); select(p.id); };
  const items = pool ? poolItems(pool, library) : [];
  return (
    <div className="split-narrow">
      <div>
        <div className="toolbar"><h2>Shared collections</h2><div className="grow" /><button className="btn sm" onClick={create}>New</button></div>
        <p className="muted small">Reusable across channels. Private pools live inside their channel and don't appear here until you "make reusable".</p>
        {shared.length === 0 && <div className="empty">None yet.</div>}
        <div className="list">
          {shared.map((p) => (
            <button key={p.id} className={`row${p.id === pool?.id ? ' active' : ''}`} onClick={() => select(p.id)}>
              {p.name}<span className="sub">{poolItems(p, library).length} items · {MODES.find((m) => m.v === p.selection)?.label} · used by {usedBy(p.id)}</span>
            </button>
          ))}
        </div>
      </div>
      {pool && (
        <div>
          <div className="panel">
            <PoolEditor pool={pool} library={library} mode="full" onChange={(patch) => updatePool(pool.id, patch)} />
            <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
              <span className="muted small">used by {usedBy(pool.id)} channel{usedBy(pool.id) === 1 ? '' : 's'}</span>
              <div className="grow" />
              <button className="btn sm danger" onClick={() => { if (confirm('Delete this collection? Channels using it will show none.')) { removePool(pool.id); setParams({ tab: 'collections' }); } }}>Delete</button>
            </div>
          </div>
          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead><tr><th>Title</th><th>Show</th><th className="mono">Length</th><th>Breaks</th></tr></thead>
              <tbody>
                {items.slice(0, 150).map((i) => {
                  const show = i.showId ? library.shows.find((x) => x.id === i.showId) : undefined;
                  return (
                    <tr key={i.id}>
                      <td>{i.title}{i.trimmable && <span className="badge" style={{ marginLeft: 6 }}>trimmable</span>}</td>
                      <td className="muted">{show ? `${show.title} S${String(i.season).padStart(2, '0')}E${String(i.episode).padStart(2, '0')}` : i.tags.filter((t) => t !== i.kind).join(', ')}</td>
                      <td className="mono">{i.durationMs ? fmtDuration(i.durationMs) : 'any'}</td>
                      <td>{i.kind === 'episode' ? (i.breakPoints.length > 0 ? <span className="badge ok">{i.breakPoints.length} · {i.breakSource}</span> : <span className="badge warn">none</span>) : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {items.length > 150 && <div className="small muted" style={{ padding: 10 }}>Showing 150 of {items.length}.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

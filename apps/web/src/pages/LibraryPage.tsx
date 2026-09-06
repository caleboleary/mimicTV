import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  parseProbeJsonl, importProbeLibrary, starterRules, fmtDuration, poolItems, buildDummyCommercials, buildDummyIdsAndFiller, DUMMY_TAG,
  type MediaKind, type ProbeHeader, type ProbeRecord, type Pool,
} from '@mimictv/core';
import { useStore } from '../store/store';
import PoolEditor, { MODES } from '../components/PoolEditor';

const KINDS: MediaKind[] = ['episode', 'movie', 'commercial', 'network-id', 'bumper', 'filler'];
type Tab = 'overview' | 'shows' | 'collections' | 'import';

async function readBlobText(blob: Blob, name: string): Promise<string> {
  if (name.endsWith('.gz')) return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return blob.text();
}
interface ReceivedFile { name: string; size: number; mtime: number }

export default function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const setTab = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t });
  const library = useStore((s) => s.library);
  const source = useStore((s) => s.librarySource);
  const eps = library.items.filter((i) => i.kind === 'episode');
  const withBreaks = eps.filter((i) => i.breakPoints.length > 0).length;

  return (
    <div>
      <div className="toolbar"><h1>Library</h1><div className="grow" /><span className="muted small">{source === 'stub' ? 'stub library' : source}</span></div>
      <div className="subtabs">
        {(['overview', 'shows', 'collections', 'import'] as Tab[]).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>)}
      </div>
      {tab === 'overview' && <Overview withBreaks={withBreaks} eps={eps.length} />}
      {tab === 'shows' && <Shows />}
      {tab === 'collections' && <Collections />}
      {tab === 'import' && <Import />}
    </div>
  );
}

function Overview({ withBreaks, eps }: { withBreaks: number; eps: number }) {
  const library = useStore((s) => s.library);
  const source = useStore((s) => s.librarySource);
  const useStub = useStore((s) => s.useStubLibrary);
  const patchLibrary = useStore((s) => s.patchLibrary);
  const dummyCount = library.items.filter((i) => i.tags.includes(DUMMY_TAG)).length;
  const addDummy = (items: ReturnType<typeof buildDummyCommercials>) => patchLibrary((lib) => ({ ...lib, items: [...lib.items.filter((i) => !items.some((n) => n.id === i.id)), ...items] }));
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
        {source !== 'stub' && <div style={{ marginTop: 12 }}><button className="btn sm" onClick={useStub}>Back to stub library</button></div>}
      </div>
      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 6 }}>
          <h3>Dummy interstitials</h3>
          <span className="muted small">fake commercials, IDs, and filler so breaks have something to hold</span>
          <div className="grow" />
          {dummyCount > 0 && <span className="badge">{dummyCount} dummy items</span>}
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="btn sm" onClick={() => addDummy(buildDummyCommercials(100))}>Add 100 commercials (mostly 15s / 30s)</button>
          <button className="btn sm" onClick={() => addDummy(buildDummyIdsAndFiller())}>Add 6 network IDs + static card + glitch loops</button>
          {dummyCount > 0 && <button className="btn sm danger" onClick={() => patchLibrary((lib) => ({ ...lib, items: lib.items.filter((i) => !i.tags.includes(DUMMY_TAG)) }))}>Remove all dummy items</button>}
        </div>
      </div>
    </>
  );
}

function Shows() {
  const library = useStore((s) => s.library);
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const m = new Map<string, { eps: number; ch: number; dur: number; seasons: Set<number> }>();
    for (const i of library.items) if (i.showId && i.kind === 'episode') {
      const r = m.get(i.showId) ?? { eps: 0, ch: 0, dur: 0, seasons: new Set<number>() };
      r.eps++; if (i.breakPoints.length) r.ch++; r.dur += i.durationMs; if (i.season != null) r.seasons.add(i.season); m.set(i.showId, r);
    }
    const ql = q.trim().toLowerCase();
    return [...library.shows].filter((s) => !ql || s.title.toLowerCase().includes(ql)).sort((a, b) => a.title.localeCompare(b.title)).map((s) => ({ show: s, ...(m.get(s.id) ?? { eps: 0, ch: 0, dur: 0, seasons: new Set<number>() }) }));
  }, [library, q]);
  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="toolbar" style={{ padding: 12, marginBottom: 0 }}><input type="text" placeholder="filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} /><span className="muted small">{rows.length} shows</span></div>
      <table>
        <thead><tr><th>Show</th><th className="mono">Eps</th><th className="mono">Seasons</th><th className="mono">Avg length</th><th>Break points</th></tr></thead>
        <tbody>
          {rows.map(({ show, eps, ch, dur, seasons }) => (
            <tr key={show.id}>
              <td>{show.title}{show.year ? <span className="muted"> ({show.year})</span> : null}</td>
              <td className="mono">{eps}</td>
              <td className="mono">{seasons.size}</td>
              <td className="mono">{eps ? fmtDuration(dur / eps) : '—'}</td>
              <td><span className={`badge ${ch === eps && eps > 0 ? 'ok' : ch === 0 ? 'warn' : ''}`}>{ch}/{eps}</span></td>
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
  const library = useStore((s) => s.library);
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

function Import() {
  const library = useStore((s) => s.library);
  const setLibrary = useStore((s) => s.setLibrary);
  const replaceRules = useStore((s) => s.replaceRules);
  const [fileName, setFileName] = useState<string>();
  const [header, setHeader] = useState<ProbeHeader>();
  const [records, setRecords] = useState<ProbeRecord[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, MediaKind>>({});
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState<ReceivedFile[]>([]);
  const refresh = () => { fetch('/imports/index.json').then((r) => (r.ok ? r.json() : [])).then(setReceived).catch(() => setReceived([])); };
  useEffect(refresh, []);
  const preview = useMemo(() => (records.length ? importProbeLibrary(records, { rootKinds: overrides }) : undefined), [records, overrides]);
  const loadText = (name: string, text: string) => { const p = parseProbeJsonl(text); setFileName(name); setHeader(p.header); setRecords(p.records); setErrors(p.errors); setOverrides({}); };
  const onReceived = async (f: ReceivedFile) => { setBusy(true); try { const res = await fetch(`/imports/${encodeURIComponent(f.name)}`); loadText(f.name, await readBlobText(await res.blob(), f.name)); } finally { setBusy(false); } };
  const onFile = async (f: File | undefined) => { if (!f) return; setBusy(true); try { loadText(f.name, await readBlobText(f, f.name)); } finally { setBusy(false); } };
  const apply = (mode: 'starter' | 'keep' | 'scratch') => {
    if (!preview) return;
    const dummies = mode === 'scratch' ? [] : library.items.filter((i) => i.tags.includes(DUMMY_TAG));
    setLibrary({ ...preview.library, items: [...preview.library.items, ...dummies] }, fileName ?? 'import');
    if (mode === 'starter') replaceRules(starterRules(preview.library));
    if (mode === 'scratch') replaceRules({ pools: [], clocks: [], channels: [] });
  };
  return (
    <>
      <div className="panel">
        <h3 style={{ marginBottom: 8 }}>Import a probe file</h3>
        <p className="muted small" style={{ marginTop: 0 }}>Run <code>scripts/probe-library.sh</code> on the machine with the media. Only paths, durations, chapters, and stream facts are read.</p>
        <input type="file" accept=".jsonl,.gz,.json,application/json" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
        {busy && <span className="muted small" style={{ marginLeft: 10 }}>parsing…</span>}
        <div className="section">
          <div className="toolbar" style={{ marginBottom: 6 }}>
            <h3>Received files</h3><span className="muted small">uploaded to <code>data/imports/</code> via <code>scripts/receive.py</code></span>
            <div className="grow" /><button className="btn sm" onClick={refresh}>Refresh</button>
          </div>
          <p className="muted small" style={{ marginTop: 0 }}>Load a file to preview it, then choose how to apply it below.</p>
          {received.length === 0 ? <div className="muted small">Nothing yet. Start <code>python3 scripts/receive.py</code> here, then run the probe with <code>-u</code> on the media box.</div> : (
            <div className="list">
              {received.map((f) => (
                <div key={f.name} className={`row-actions${fileName === f.name ? ' active' : ''}`}>
                  <div>{f.name}<span className="sub">{(f.size / 1024).toFixed(0)} KB · {new Date(f.mtime).toLocaleString()}{fileName === f.name ? ' · loaded' : ''}</span></div>
                  <button className={`btn sm${fileName === f.name ? '' : ' primary'}`} disabled={busy} onClick={() => onReceived(f)}>{fileName === f.name ? 'Reload' : 'Load'}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {preview && (
        <div className="panel">
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <h2>{fileName}</h2>
            <span className="muted small">{header ? `from ${header.host}, ${new Date(header.generated_at).toLocaleString()}` : 'no header'}</span>
            <div className="grow" />
            {errors.length > 0 && <span className="badge warn">{errors.length} unreadable</span>}
            <span className="badge">{records.length} files</span>
          </div>
          <table>
            <thead><tr><th>Root folder</th><th>Kind</th><th className="mono">Files</th><th className="mono">Runtime</th><th>Shows</th><th>Eps with chapters</th></tr></thead>
            <tbody>
              {preview.roots.map((r) => (
                <tr key={r.root}>
                  <td className="mono">{r.root}</td>
                  <td><select value={overrides[r.root] ?? r.kind} onChange={(e) => setOverrides((o) => ({ ...o, [r.root]: e.target.value as MediaKind }))}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></td>
                  <td className="mono">{r.count}</td>
                  <td className="mono">{fmtDuration(r.durationMs)}</td>
                  <td>{r.kind === 'episode' ? r.shows : <span className="muted">—</span>}</td>
                  <td>{r.episodes > 0 ? <span className={`badge ${r.withChapters === r.episodes ? 'ok' : r.withChapters === 0 ? 'warn' : ''}`}>{r.withChapters}/{r.episodes}</span> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="toolbar" style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={() => apply('keep')}>Use library, keep my channels</button>
            <button className="btn" onClick={() => apply('scratch')}>Use library, start from scratch</button>
            <button className="btn" onClick={() => apply('starter')}>Use library + generate starter channels</button>
          </div>
          {errors.length > 0 && <details style={{ marginTop: 10 }}><summary className="small muted">Unreadable files</summary><pre className="code">{errors.join('\n')}</pre></details>}
        </div>
      )}
    </>
  );
}

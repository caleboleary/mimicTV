import { useEffect, useMemo, useState } from 'react';
import {
  parseProbeJsonl, importProbeLibrary, starterRules, fmtDuration, buildDummyCommercials, buildDummyIdsAndFiller, DUMMY_TAG,
  type MediaKind, type ProbeHeader, type ProbeRecord,
} from '@mimictv/core';
import { useStore } from '../store/store';

const KINDS: MediaKind[] = ['episode', 'movie', 'commercial', 'network-id', 'filler'];

async function readFileText(file: File): Promise<string> {
  return readBlobText(file, file.name);
}

async function readBlobText(blob: Blob, name: string): Promise<string> {
  if (name.endsWith('.gz')) {
    const ds = new DecompressionStream('gzip');
    return new Response(blob.stream().pipeThrough(ds)).text();
  }
  return blob.text();
}

interface ReceivedFile { name: string; size: number; mtime: number }

export default function LibraryPage() {
  const library = useStore((s) => s.library);
  const source = useStore((s) => s.librarySource);
  const setLibrary = useStore((s) => s.setLibrary);
  const replaceRules = useStore((s) => s.replaceRules);
  const useStub = useStore((s) => s.useStubLibrary);
  const patchLibrary = useStore((s) => s.patchLibrary);
  const dummyCount = library.items.filter((i) => i.tags.includes(DUMMY_TAG)).length;
  const addDummy = (items: ReturnType<typeof buildDummyCommercials>) =>
    patchLibrary((lib) => ({ ...lib, items: [...lib.items.filter((i) => !items.some((n) => n.id === i.id)), ...items] }));
  const removeDummy = () => patchLibrary((lib) => ({ ...lib, items: lib.items.filter((i) => !i.tags.includes(DUMMY_TAG)) }));

  const [fileName, setFileName] = useState<string>();
  const [header, setHeader] = useState<ProbeHeader>();
  const [records, setRecords] = useState<ProbeRecord[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, MediaKind>>({});
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState<ReceivedFile[]>([]);

  const refreshReceived = () => {
    fetch('/imports/index.json').then((r) => (r.ok ? r.json() : [])).then(setReceived).catch(() => setReceived([]));
  };
  useEffect(refreshReceived, []);

  const loadText = (name: string, text: string) => {
    const parsed = parseProbeJsonl(text);
    setFileName(name); setHeader(parsed.header); setRecords(parsed.records); setErrors(parsed.errors); setOverrides({});
  };

  const onReceived = async (f: ReceivedFile) => {
    setBusy(true);
    try {
      const res = await fetch(`/imports/${encodeURIComponent(f.name)}`);
      loadText(f.name, await readBlobText(await res.blob(), f.name));
    } finally { setBusy(false); }
  };

  const preview = useMemo(() => (records.length ? importProbeLibrary(records, { rootKinds: overrides }) : undefined), [records, overrides]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      loadText(f.name, await readFileText(f));
    } finally { setBusy(false); }
  };

  const apply = (mode: 'starter' | 'keep' | 'scratch') => {
    if (!preview) return;
    const dummies = mode === 'scratch' ? [] : library.items.filter((i) => i.tags.includes(DUMMY_TAG));
    setLibrary({ ...preview.library, items: [...preview.library.items, ...dummies] }, fileName ?? 'import');
    if (mode === 'starter') replaceRules(starterRules(preview.library));
    if (mode === 'scratch') replaceRules({ pools: [], clocks: [], channels: [] });
  };

  const counts = KINDS.map((k) => [k, library.items.filter((i) => i.kind === k).length] as const);
  const eps = library.items.filter((i) => i.kind === 'episode');
  const withBreaks = eps.filter((i) => i.breakPoints.length > 0).length;

  return (
    <div>
      <div className="toolbar"><h1>Library</h1></div>

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <h3>Current: {source === 'stub' ? 'stub library' : source}</h3>
          <div className="grow" />
          {source !== 'stub' && <button className="btn sm" onClick={useStub}>Back to stub library</button>}
        </div>
        <div className="stats">
          <div className="stat"><b>{library.shows.length}</b><span>shows</span></div>
          {counts.map(([k, n]) => <div className="stat" key={k}><b>{n}</b><span>{k}</span></div>)}
          <div className="stat"><b>{eps.length ? Math.round((withBreaks / eps.length) * 100) : 0}%</b><span>eps with breaks</span></div>
          <div className="stat"><b>{fmtDuration(library.items.reduce((n, i) => n + i.durationMs, 0))}</b><span>runtime</span></div>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 6 }}>
          <h3>Dummy interstitials</h3>
          <span className="muted small">fake commercials, IDs, and filler so clocks have something to fill breaks with</span>
          <div className="grow" />
          {dummyCount > 0 && <span className="badge">{dummyCount} dummy items</span>}
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="btn sm" onClick={() => addDummy(buildDummyCommercials(100))}>Add 100 commercials (mostly 15s / 30s)</button>
          <button className="btn sm" onClick={() => addDummy(buildDummyIdsAndFiller())}>Add 6 network IDs + static card + glitch loops</button>
          {dummyCount > 0 && <button className="btn sm danger" onClick={removeDummy}>Remove all dummy items</button>}
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginBottom: 8 }}>Import a probe file</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Run <code>scripts/probe-library.sh</code> on the machine with the media, then drop the resulting <code>library.jsonl</code> (or <code>.gz</code>) here. Only paths, durations, chapters, and stream facts are read.
        </p>
        <input type="file" accept=".jsonl,.gz,.json,application/json" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
        {busy && <span className="muted small" style={{ marginLeft: 10 }}>parsing…</span>}

        <div className="section">
          <div className="toolbar" style={{ marginBottom: 6 }}>
            <h3>Received files</h3>
            <span className="muted small">uploaded to <code>data/imports/</code> via <code>scripts/receive.py</code></span>
            <div className="grow" />
            <button className="btn sm" onClick={refreshReceived}>Refresh</button>
          </div>
          {received.length === 0 ? (
            <div className="muted small">Nothing yet. Start <code>python3 scripts/receive.py</code> here, then run the probe with <code>-u</code> on the media box.</div>
          ) : (
            <div className="list">
              {received.map((f) => (
                <button key={f.name} className={`row${fileName === f.name ? ' active' : ''}`} disabled={busy} onClick={() => onReceived(f)}>
                  {f.name}
                  <span className="sub">{(f.size / 1024).toFixed(0)} KB · {new Date(f.mtime).toLocaleString()}</span>
                </button>
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
                  <td>
                    <select value={overrides[r.root] ?? r.kind} onChange={(e) => setOverrides((o) => ({ ...o, [r.root]: e.target.value as MediaKind }))}>
                      {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </td>
                  <td className="mono">{r.count}</td>
                  <td className="mono">{fmtDuration(r.durationMs)}</td>
                  <td>{r.kind === 'episode' ? r.shows : <span className="muted">—</span>}</td>
                  <td>{r.episodes > 0 ? <span className={`badge ${r.withChapters === r.episodes ? 'ok' : r.withChapters === 0 ? 'warn' : ''}`}>{r.withChapters}/{r.episodes}</span> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="toolbar" style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={() => apply('scratch')}>Use library, start from scratch</button>
            <button className="btn" onClick={() => apply('starter')}>Use library + generate starter pools, clocks, channels</button>
            <button className="btn" onClick={() => apply('keep')}>Use library, keep my rules</button>
          </div>
          {errors.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary className="small muted">Unreadable files</summary>
              <pre className="code">{errors.join('\n')}</pre>
            </details>
          )}
          <details style={{ marginTop: 10 }}>
            <summary className="small muted">Shows detected ({preview.library.shows.length})</summary>
            <div className="small" style={{ columns: 3, marginTop: 6 }}>
              {preview.library.shows.map((s) => <div key={s.id}>{s.title}{s.year ? ` (${s.year})` : ''} <span className="muted">· {preview.library.items.filter((i) => i.showId === s.id).length} eps</span></div>)}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Library, MediaKind } from '@mimictv/core';
import { useStore } from '../store/store';
import { Disclosure, Help } from '../components/Card';

const KINDS: MediaKind[] = ['episode', 'movie', 'commercial', 'network-id', 'bumper', 'filler'];

interface Settings {
  library: { roots: { path: string; kind?: MediaKind }[]; ffprobe: string };
  next: { outputDir: string; horizonDays: number; refreshHours: number; pathMap: { from: string; to: string }[]; resolverUrl: string; publicUrl: string; video: { width: number; height: number; bitrateKbps: number; format: string; accel: string } };
}
interface ScanStatus { running: boolean; total: number; done: number; failed: number; current?: string; error?: string; finishedAt?: number; roots?: { root: string; kind: string; count: number; episodes: number; withChapters: number }[] }
interface PublishResult { at: number; outputDir: string; error?: string; channels: { id: string; name: string; files: string[]; boundary: number }[] }
interface Health { ok: boolean; dataDir: string; scan: ScanStatus; lastPublish: PublishResult | null; nextPublishAt: number | null }

async function getJson<T>(url: string): Promise<T | undefined> { try { const r = await fetch(url); return r.ok ? ((await r.json()) as T) : undefined; } catch { return undefined; } }
async function send(url: string, method: string, body?: unknown): Promise<Response | undefined> { try { return await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }); } catch { return undefined; } }

export default function SetupPage() {
  const setLibrary = useStore((s) => s.setLibrary);
  const setNextUrl = useStore((s) => s.setNextUrl);
  const channels = useStore((s) => s.channels);
  const [health, setHealth] = useState<Health | null | undefined>();
  const [settings, setSettings] = useState<Settings>();
  const [scan, setScan] = useState<ScanStatus>();
  const [publish, setPublish] = useState<PublishResult | null>();
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const refreshHealth = async () => { const h = await getJson<Health>('/api/health'); setHealth(h ?? null); if (h) { setScan(h.scan); setPublish(h.lastPublish); } };
  useEffect(() => { refreshHealth(); getJson<Settings>('/api/settings').then(setSettings); }, []);

  // Poll while a scan runs; when it finishes, pull the new library into the app.
  useEffect(() => {
    if (!scan?.running) return;
    const t = setInterval(async () => {
      const s = await getJson<ScanStatus>('/api/scan/status');
      if (!s) return;
      setScan(s);
      if (!s.running) {
        clearInterval(t);
        const lib = await getJson<{ library: Library; source: string }>('/api/library');
        if (lib?.library) setLibrary(lib.library, lib.source);
        refreshHealth();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [scan?.running]);

  const update = (fn: (s: Settings) => Settings) => {
    setSettings((s) => {
      if (!s) return s;
      const next = fn(s);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => send('/api/settings', 'PUT', next), 500);
      return next;
    });
  };
  const startScan = async () => {
    setBusy(true);
    clearTimeout(saveTimer.current);
    if (settings) await send('/api/settings', 'PUT', settings);
    const r = await send('/api/scan', 'POST');
    setBusy(false);
    if (r?.ok) setScan({ running: true, total: 0, done: 0, failed: 0 });
    else setScan({ running: false, total: 0, done: 0, failed: 0, error: r ? ((await r.json()) as { error?: string }).error : 'Service not reachable' });
  };
  const publishNow = async () => {
    setBusy(true);
    clearTimeout(saveTimer.current);
    if (settings) await send('/api/settings', 'PUT', settings);
    const r = await send('/api/publish', 'POST');
    setPublish(r ? ((await r.json()) as PublishResult) : { at: Date.now(), outputDir: '', error: 'Service not reachable', channels: [] });
    setBusy(false);
    refreshHealth();
  };

  if (health === null) {
    return (
      <div>
        <div className="toolbar"><h1>Setup</h1></div>
        <div className="panel empty">
          <p>The mimicTV service isn't running, so scanning and publishing aren't available. Your channels still work in the browser.</p>
          <pre className="code" style={{ display: 'inline-block', textAlign: 'left' }}>npm run dev</pre>
          <p className="muted small">starts the app and the service together.</p>
          <button className="btn sm" onClick={refreshHealth}>Try again</button>
        </div>
      </div>
    );
  }
  if (!settings || !health) return <div className="empty">Loading…</div>;

  const pct = scan && scan.total > 0 ? Math.round((scan.done / scan.total) * 100) : 0;
  return (
    <div>
      <div className="toolbar"><h1>Setup</h1><div className="grow" /><span className="muted small">service online · data in <code>{health.dataDir}</code></span></div>

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 6 }}>
          <h2>1. Where your media is</h2>
          <Help><p><b>Folders mimicTV scans.</b> One row per top-level folder: your TV shows, your commercials, your bumpers. Each folder is read with ffprobe to learn durations and chapters. Nothing is copied or changed.</p><p>The kind is guessed from the folder name; set it here if the guess is wrong.</p></Help>
        </div>
        <div className="recipe" style={{ gap: 6 }}>
          {settings.library.roots.map((r, i) => (
            <div key={i} className="search-row" style={{ gridTemplateColumns: '1fr auto auto' }}>
              <input type="text" placeholder="/mnt/user/media/tv" value={r.path} onChange={(e) => update((s) => ({ ...s, library: { ...s.library, roots: s.library.roots.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)) } }))} />
              <select value={r.kind ?? ''} onChange={(e) => update((s) => ({ ...s, library: { ...s.library, roots: s.library.roots.map((x, j) => (j === i ? { ...x, kind: (e.target.value || undefined) as MediaKind | undefined } : x)) } }))}>
                <option value="">guess kind</option>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <button className="btn sm" onClick={() => update((s) => ({ ...s, library: { ...s.library, roots: s.library.roots.filter((_, j) => j !== i) } }))}>×</button>
            </div>
          ))}
          <div><button className="btn sm" onClick={() => update((s) => ({ ...s, library: { ...s.library, roots: [...s.library.roots, { path: '' }] } }))}>+ add folder</button></div>
        </div>
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className="btn primary" disabled={busy || scan?.running || settings.library.roots.every((r) => !r.path)} onClick={startScan}>{scan?.running ? 'Scanning…' : 'Scan now'}</button>
          {scan?.running && <span className="muted small">{scan.done}/{scan.total} · {pct}%{scan.current ? ` · ${scan.current}` : ''}</span>}
          {scan && !scan.running && scan.finishedAt && !scan.error && <span className="badge ok">done · {scan.done} files{scan.failed ? `, ${scan.failed} unreadable` : ''}</span>}
          {scan?.error && <span className="badge warn">{scan.error}</span>}
          <div className="grow" />
          <Disclosure label="ffprobe location">
            <label className="field">Command to run ffprobe<input type="text" value={settings.library.ffprobe} onChange={(e) => update((s) => ({ ...s, library: { ...s.library, ffprobe: e.target.value } }))} style={{ width: 360 }} /></label>
            <p className="muted small" style={{ margin: '6px 0 0' }}>Usually just <code>ffprobe</code>. If it only exists in a container: <code>docker exec -i ersatztv ffprobe</code>, and use container paths above.</p>
          </Disclosure>
        </div>
        {scan?.roots && !scan.running && (
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>Folder</th><th>Kind</th><th className="mono">Files</th><th className="mono">Episodes</th><th>With chapters</th></tr></thead>
            <tbody>{scan.roots.map((r) => <tr key={r.root}><td className="mono">{r.root}</td><td>{r.kind}</td><td className="mono">{r.count}</td><td className="mono">{r.episodes || '—'}</td><td>{r.episodes ? <span className={`badge ${r.withChapters === r.episodes ? 'ok' : r.withChapters === 0 ? 'warn' : ''}`}>{r.withChapters}/{r.episodes}</span> : '—'}</td></tr>)}</tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 6 }}>
          <h2>2. Where ErsatzTV Next reads from</h2>
          <Help><p><b>The folder mimicTV writes for ErsatzTV Next.</b> It gets a <code>lineup.json</code>, one folder per channel with its <code>channel.json</code> and playout files, and an <code>xmltv</code> folder for the guide. Point ErsatzTV Next at the lineup file.</p><p>ErsatzTV Next reads the lineup only when it starts, so restart it after adding or removing a channel.</p><p>Files are kept a few days ahead and topped up on a schedule. Editing a channel rewrites its future from the next break, never the block that's playing.</p></Help>
        </div>
        <div className="form-grid">
          <label className="field" style={{ gridColumn: '1 / -1' }}>Output folder<input type="text" placeholder="/mnt/user/appdata/ersatztv-next" value={settings.next.outputDir} onChange={(e) => update((s) => ({ ...s, next: { ...s.next, outputDir: e.target.value } }))} /></label>
          <label className="field">Days written ahead<input type="number" min={1} max={14} value={settings.next.horizonDays} onChange={(e) => update((s) => ({ ...s, next: { ...s.next, horizonDays: Math.max(1, Number(e.target.value)) } }))} /></label>
          <label className="field">Top up every (hours)<input type="number" min={0.25} step={0.25} value={settings.next.refreshHours} onChange={(e) => update((s) => ({ ...s, next: { ...s.next, refreshHours: Math.max(0.25, Number(e.target.value)) } }))} /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>Where ErsatzTV Next is on your network<input type="text" placeholder="http://192.168.1.10:8410" value={settings.next.publicUrl} onChange={(e) => { setNextUrl(e.target.value); update((s) => ({ ...s, next: { ...s.next, publicUrl: e.target.value } })); }} /><span className="muted small">TV apps get their M3U and guide from here (links in the sidebar), and ▶ on the Guide plays from it.</span></label>
        </div>
        <Disclosure label="Paths look different on the ErsatzTV Next machine">
          <p className="muted small" style={{ marginTop: 0 }}>If the library was scanned at one path but ErsatzTV Next sees the same files at another, map the prefix. Left: as scanned. Right: as ErsatzTV Next sees it.</p>
          {settings.next.pathMap.map((m, i) => (
            <div key={i} className="search-row" style={{ gridTemplateColumns: '1fr auto 1fr auto', marginBottom: 6 }}>
              <input type="text" placeholder="/media" value={m.from} onChange={(e) => update((s) => ({ ...s, next: { ...s.next, pathMap: s.next.pathMap.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) } }))} />
              <span className="muted small">→</span>
              <input type="text" placeholder="/mnt/user/media" value={m.to} onChange={(e) => update((s) => ({ ...s, next: { ...s.next, pathMap: s.next.pathMap.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) } }))} />
              <button className="btn sm" onClick={() => update((s) => ({ ...s, next: { ...s.next, pathMap: s.next.pathMap.filter((_, j) => j !== i) } }))}>×</button>
            </div>
          ))}
          <button className="btn sm" onClick={() => update((s) => ({ ...s, next: { ...s.next, pathMap: [...s.next.pathMap, { from: '', to: '' }] } }))}>+ add mapping</button>
        </Disclosure>
        <Disclosure label="Video output and live ads">
          <div className="form-grid">
            <label className="field">Width<input type="number" value={settings.next.video.width} onChange={(e) => update((s) => ({ ...s, next: { ...s.next, video: { ...s.next.video, width: Number(e.target.value) } } }))} /></label>
            <label className="field">Height<input type="number" value={settings.next.video.height} onChange={(e) => update((s) => ({ ...s, next: { ...s.next, video: { ...s.next.video, height: Number(e.target.value) } } }))} /></label>
            <label className="field">Bitrate (kbps)<input type="number" value={settings.next.video.bitrateKbps} onChange={(e) => update((s) => ({ ...s, next: { ...s.next, video: { ...s.next.video, bitrateKbps: Number(e.target.value) } } }))} /></label>
            <label className="field">Hardware accel<input type="text" placeholder="none, vaapi, nvenc, qsv, videotoolbox" value={settings.next.video.accel} onChange={(e) => update((s) => ({ ...s, next: { ...s.next, video: { ...s.next.video, accel: e.target.value } } }))} /></label>
            <label className="field" style={{ gridColumn: '1 / -1' }}>URL ErsatzTV Next can reach mimicTV on, for channels that pick ads live<input type="text" placeholder="http://192.168.1.10:8787 (leave empty to write ads in advance)" value={settings.next.resolverUrl} onChange={(e) => update((s) => ({ ...s, next: { ...s.next, resolverUrl: e.target.value } }))} /></label>
          </div>
        </Disclosure>
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className="btn primary" disabled={busy || !settings.next.outputDir} onClick={publishNow}>Publish now</button>
          {publish?.error && <span className="badge warn">{publish.error}</span>}
          {publish && !publish.error && <span className="badge ok">{publish.channels.length} channel{publish.channels.length === 1 ? '' : 's'} written {new Date(publish.at).toLocaleString()}</span>}
          {health.nextPublishAt && settings.next.outputDir && <span className="muted small">next automatic top-up {new Date(health.nextPublishAt).toLocaleTimeString()}</span>}
          <div className="grow" />
          <span className="muted small">{channels.length} channel{channels.length === 1 ? '' : 's'} in the lineup</span>
        </div>
        {publish && !publish.error && publish.channels.length > 0 && (
          <Disclosure label="What was written">
            <div className="recipe" style={{ gap: 4 }}>
              <div className="mono small muted">{publish.outputDir}/lineup.json</div>
              {publish.channels.map((c) => <div key={c.id} className="small"><b>{c.name}</b> <span className="muted mono">channels/{c.id}/</span> · {c.files.length} playout file{c.files.length === 1 ? '' : 's'} · new rules from {new Date(c.boundary).toLocaleTimeString()}</div>)}
            </div>
          </Disclosure>
        )}
      </div>
    </div>
  );
}

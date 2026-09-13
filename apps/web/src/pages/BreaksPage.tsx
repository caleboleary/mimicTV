import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  planShow, describeGroup, mmss, fmtDuration, DEFAULT_DETECT, SENSITIVITY,
  type BlackRow, type DetectSettings, type EpisodeInput, type EpisodePlan, type GroupPlan, type ShowBreaks, type FileBreaks, type MediaItem,
} from '@mimictv/core';
import { useStore, useLibrary } from '../store/store';
import { Disclosure } from '../components/Card';

interface Job { running: boolean; folder?: string; total: number; done: number; current?: string; phase?: 'blacks' | 'scenes'; error?: string; finishedAt?: number; queue?: string[] }
interface Estimate { files: string[]; minutes: number; skipped: { rel: string; why: string }[] }
/** The service's own analyze/unqueue response: which one it did, and where a queued show stands. */
type Ack = { started?: boolean; queued?: boolean; position?: number; removed?: boolean };

async function getJson<T>(url: string): Promise<T | undefined> { try { const r = await fetch(url); return r.ok ? ((await r.json()) as T) : undefined; } catch { return undefined; } }
async function send(url: string, method: string, body?: unknown): Promise<Response | undefined> { try { return await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }); } catch { return undefined; } }

/** The show folder is the level right under a library root: /media/TV/<Show>. */
export const showFolderOf = (item: MediaItem) => item.path.split('/').slice(0, 4).join('/');
const relOf = (folder: string, p: string) => p.slice(folder.length + 1);

type Sensitivity = keyof typeof SENSITIVITY;
const sensitivityOf = (s: Partial<DetectSettings>): Sensitivity => (Object.entries(SENSITIVITY).find(([, v]) => v.minBlack === (s.minBlack ?? DEFAULT_DETECT.minBlack) && v.pix === (s.pix ?? DEFAULT_DETECT.pix))?.[0] as Sensitivity) ?? 'normal';

/** Local, unsaved edits per episode. */
interface Edit { picks?: number[]; off?: 'timed' | 'none' }

export default function BreaksPage() {
  const [params] = useSearchParams();
  const folder = params.get('folder') ?? '';
  const library = useLibrary();
  const setLibrary = useStore((s) => s.setLibrary);
  const episodes = useMemo(() => library.items.filter((i) => i.kind === 'episode' && showFolderOf(i) === folder).sort((a, b) => a.path.localeCompare(b.path)), [library, folder]);
  const show = library.shows.find((s) => s.id === episodes[0]?.showId);
  const [saved, setSaved] = useState<ShowBreaks>();
  const [job, setJob] = useState<Job>();
  const [estimate, setEstimate] = useState<Estimate>();
  const [tune, setTune] = useState<Partial<DetectSettings>>({});
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  const settings = useMemo(() => ({ ...saved?.settings, ...tune }), [saved, tune]);
  const load = async () => {
    const s = await getJson<ShowBreaks>(`/api/breaks/show?folder=${encodeURIComponent(folder)}`);
    if (s) { setSaved(s); setTune({}); setEdits({}); }
    const r = await send('/api/breaks/plan', 'POST', { folder, settings: s?.settings ?? {} });
    if (r?.ok) setEstimate((await r.json()) as Estimate);
  };
  useEffect(() => { load(); getJson<Job>('/api/breaks/status').then(setJob); }, [folder]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!job?.running && !job?.queue?.length) return;
    const t = setInterval(async () => {
      const j = await getJson<Job>('/api/breaks/status');
      if (!j) return;
      setJob(j);
      if (!j.running && !j.queue?.length) { clearInterval(t); load(); }
    }, 1000);
    return () => clearInterval(t);
  }, [job?.running, job?.queue?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Re-estimate when the knobs that need a re-measure change.
  useEffect(() => { if (!saved) return; send('/api/breaks/plan', 'POST', { folder, settings }).then(async (r) => { if (r?.ok) setEstimate((await r.json()) as Estimate); }); }, [settings.minBlack, settings.pix, settings.edge]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshLibrary = async () => { const lib = await getJson<{ library: typeof library; source: string }>('/api/library'); if (lib?.library) setLibrary(lib.library, lib.source); };

  // ---- the plan, recomputed on every knob from what's measured
  const inputs: EpisodeInput[] = useMemo(() => episodes.map((i) => { const f = saved?.files[relOf(folder, i.path)]; return { rel: relOf(folder, i.path), durationMs: i.durationMs, blacks: f?.measured?.blacks, scenes: f?.measured?.scenes, rejected: f?.rejected }; }), [episodes, saved, folder]);
  const plan = useMemo(() => planShow(inputs, settings), [inputs, settings]);
  const blacksByRel = useMemo(() => new Map(inputs.map((i) => [i.rel, i.blacks ?? []])), [inputs]);
  const measured = inputs.filter((i) => i.blacks).length;
  const planned = plan.groups.flatMap((g) => g.episodes).filter((e) => !e.skipped);

  // ---- what's in force right now
  const decided = episodes.map((i) => saved?.files[relOf(folder, i.path)]?.decision).filter(Boolean);
  const release = episodes.filter((i) => i.breakSource === 'chapters' && !i.chaptersOurs).length;
  const ours = episodes.filter((i) => i.chaptersOurs).length;
  const avgMarks = release ? episodes.filter((i) => i.breakSource === 'chapters').reduce((n, i) => n + i.breakPoints.length, 0) / release : 0;
  const current = decided.length ? `saved decisions on ${decided.length} of ${episodes.length} episodes (${['detected', 'manual', 'timed', 'none'].map((d) => [d, decided.filter((x) => x === d).length] as const).filter(([, n]) => n).map(([d, n]) => `${n} ${d}`).join(', ')})`
    : ours ? `chapters written by the old tool on ${ours} episodes`
    : release ? `chapters that came with the files on ${release} episodes, about ${avgMarks.toFixed(1)} per episode. Those are usually scene marks, not breaks, so every one becomes an ad break.`
    : `no break points: the channel format's timed fallback decides where ads go.`;

  const effectivePicks = (e: EpisodePlan): number[] => edits[e.rel]?.picks ?? e.picks;
  const togglePick = (e: EpisodePlan, ms: number) => setEdits((ed) => { const cur = effectivePicks(e); const next = cur.some((p) => Math.abs(p - ms) < 500) ? cur.filter((p) => Math.abs(p - ms) >= 500) : [...cur, ms].sort((a, b) => a - b); return { ...ed, [e.rel]: { ...ed[e.rel], picks: next } }; });
  const setOff = (e: EpisodePlan, off?: Edit['off']) => setEdits((ed) => ({ ...ed, [e.rel]: { ...ed[e.rel], off } }));

  const analyze = async (force = false) => {
    setBusy(true); setMsg(undefined);
    const r = await send('/api/breaks/analyze', 'POST', { folder, settings, force });
    setBusy(false);
    if (!r) { setMsg('Service not reachable'); return; }
    if (!r.ok) { const e = await r.json().catch(() => undefined) as { error?: string } | undefined; setMsg(e?.error); return; }
    const b = await r.json().catch(() => undefined) as Ack | undefined; // the service's own analyze response
    const j = await getJson<Job>('/api/breaks/status');
    if (b?.queued) {
      if (j) setJob(j);
      setMsg(b.position === 1 ? 'queued: it starts when the analysis in progress finishes' : `queued: ${b.position} in line`);
    } else {
      // started now: show the bar right away, before the first status poll
      setJob(j?.running && j.folder === folder ? j : { running: true, folder, total: estimate?.files.length ?? 0, done: 0, phase: 'blacks', queue: j?.queue });
    }
  };
  const cancel = () => send('/api/breaks/cancel', 'POST');
  const unqueue = async () => {
    const r = await send('/api/breaks/unqueue', 'POST', { folder });
    if (!r?.ok) return;
    const ack = await r.json().catch(() => undefined) as Ack | undefined; // the service's own unqueue response
    if (ack?.removed) { const j = await getJson<Job>('/api/breaks/status'); if (j) setJob(j); }
  };

  const save = async (mode: 'plan' | 'timed' | 'none' | 'clear' | 'embedded') => {
    setBusy(true); setMsg(undefined);
    const base: ShowBreaks = saved ?? { version: 1, folder, settings: {}, files: {} };
    const files: Record<string, FileBreaks> = { ...base.files };
    const keyOf = (i: MediaItem) => ({ size: i.media?.sizeBytes, durationMs: i.durationMs });
    if (mode === 'embedded') {
      const r = await send('/api/breaks/import-embedded', 'POST', { folder });
      setMsg(r?.ok ? `kept the old tool's chapters on ${((await r.json()) as { imported: number }).imported} episodes` : 'failed');
    } else {
      for (const i of episodes) {
        const rel = relOf(folder, i.path);
        const prev = files[rel];
        if (mode === 'clear') { if (prev) files[rel] = { ...prev, decision: undefined, breaks: [] }; continue; }
        if (mode === 'timed' || mode === 'none') { files[rel] = { key: keyOf(i), decision: mode, breaks: [], rejected: prev?.rejected ?? [], measured: prev?.measured }; continue; }
        const e = planned.find((x) => x.rel === rel);
        if (!e) {
          // Shorts never get breaks; other skipped files are left as they were.
          if (plan.skipped.find((s) => s.rel === rel)?.why.startsWith('short')) files[rel] = { key: keyOf(i), decision: 'none', breaks: [], rejected: prev?.rejected ?? [], measured: prev?.measured };
          continue;
        }
        const ed = edits[rel];
        const picks = effectivePicks(e);
        const edited = !!ed?.picks && JSON.stringify(ed.picks) !== JSON.stringify(e.picks);
        const rejected = [...new Set([...(prev?.rejected ?? []), ...e.picks.filter((p) => !picks.some((x) => Math.abs(x - p) < 500))])];
        const decision: FileBreaks['decision'] = ed?.off ?? (picks.length ? (edited ? 'manual' : 'detected') : 'timed');
        files[rel] = { key: keyOf(i), decision, rejected, measured: prev?.measured,
          breaks: decision === 'timed' || decision === 'none' ? [] : picks.map((at) => ({ at, source: edited && !e.picks.includes(at) ? 'manual' as const : (e.sources[e.picks.indexOf(at)] ?? 'detected'), confidence: e.flags.length ? 'weak' as const : 'strong' as const })) };
      }
      const r = await send('/api/breaks/show', 'PUT', { ...base, settings, files });
      setMsg(r?.ok ? 'saved: channels re-flow from their next break' : 'save failed');
    }
    await load(); await refreshLibrary();
    setBusy(false);
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text()) as ShowBreaks;
      if (j.version !== 1 || typeof j.files !== 'object') throw new Error('expected {"version":1,"folder":…,"files":{…}}');
      const r = await send('/api/breaks/show', 'PUT', { ...j, folder });
      setMsg(r?.ok ? `loaded ${Object.keys(j.files).length} files from ${f.name}` : 'upload failed');
      await load(); await refreshLibrary();
    } catch (e) { setMsg(`Not a breaks file: ${(e as Error).message}`); }
  };

  if (!folder || episodes.length === 0) return <div><div className="toolbar"><h1>Breaks</h1></div><div className="panel empty">No episodes under <code>{folder || '(no folder)'}</code>. <Link to="/library?tab=shows">Back to shows</Link></div></div>;
  const running = job?.running && job.folder === folder;
  const queued = !running && !!job?.queue?.includes(folder);
  const queuePos = (job?.queue?.indexOf(folder) ?? -1) + 1;
  const otherRunning = job?.running && job.folder !== folder;
  const pct = job && job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
  const dirty = Object.keys(edits).length > 0 || Object.keys(tune).length > 0;

  return (
    <div>
      <div className="toolbar">
        <h1>{show?.title ?? episodes[0]!.tags[1]}</h1>
        <span className="muted small">{episodes.length} episodes · <code>{folder}</code></span>
        <div className="grow" />
        <Link to="/library?tab=shows" className="btn sm">← Shows</Link>
      </div>

      <div className="panel">
        <h3>Right now</h3>
        <p style={{ margin: '4px 0 0' }}>{current}</p>
      </div>

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 6 }}>
          <h2>1. Find the breaks</h2>
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          mimicTV watches each episode for the fades to black that shows use around commercial breaks, then lines them up across the season. Nothing is written to your video files.
          {' '}{estimate && estimate.files.length > 0 ? <b>This takes about {estimate.minutes < 1 ? 'a minute' : `${estimate.minutes} minutes`} for {estimate.files.length} episode{estimate.files.length === 1 ? '' : 's'}.</b> : measured > 0 ? <b>All {measured} eligible episodes are measured.</b> : null}
          {' '}You can leave this page; it keeps going.
        </p>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          {running ? (
            <>
              <button className="btn sm" onClick={cancel}>Cancel</button>
              <div className="progress"><i style={{ width: `${pct}%` }} /></div>
              <span className="muted small">{job!.done}/{job!.total} · {job!.phase === 'scenes' ? 'checking episodes with no fade' : 'watching for fades'}{job!.current ? ` · ${job!.current}` : ''}{job!.queue?.length ? ` · ${job!.queue.length} more queued` : ''}</span>
            </>
          ) : queued ? (
            <>
              <button className="btn sm" onClick={unqueue}>Cancel</button>
              <span className="muted small">queued{queuePos === 1 ? ': next up,' : `: ${queuePos} in line,`} it starts when the analysis before it finishes</span>
            </>
          ) : (
            <>
              <button className="btn primary" disabled={busy || (estimate?.files.length ?? 0) === 0} onClick={() => analyze(false)}>{measured > 0 && (estimate?.files.length ?? 0) > 0 ? 'Analyze the rest' : 'Analyze'}</button>
              {measured > 0 && <button className="btn sm" disabled={busy} onClick={() => analyze(true)} title="Measure everything again with the current sensitivity">Re-analyze all</button>}
              {otherRunning && <span className="muted small">another show is being analyzed; this one will queue behind it</span>}
              {job?.error && job.folder === folder && <span className="badge warn">{job.error}</span>}
              {estimate && estimate.skipped.length > 0 && <span className="muted small">{estimate.skipped.length} file{estimate.skipped.length === 1 ? '' : 's'} left alone (shorts, extras, odd runtimes)</span>}
            </>
          )}
        </div>
        <Disclosure label="Tune">
          <div className="form-grid">
            <label className="field">Breaks per episode
              <select value={settings.breaksPerEpisode ?? ''} onChange={(e) => setTune((t) => ({ ...t, breaksPerEpisode: e.target.value === '' ? null : Number(e.target.value) }))}>
                <option value="">automatic (from the runtime)</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="field">Fade sensitivity
              <select value={sensitivityOf(settings)} onChange={(e) => setTune((t) => ({ ...t, ...SENSITIVITY[e.target.value as Sensitivity] }))}>
                <option value="normal">normal</option><option value="sensitive">sensitive: short, not-quite-black fades</option><option value="strict">strict: only long, fully black gaps</option>
              </select>
            </label>
            <label className="field">Ignore the first and last (seconds)<input type="number" min={0} value={settings.edge ?? DEFAULT_DETECT.edge} onChange={(e) => setTune((t) => ({ ...t, edge: Number(e.target.value) }))} /></label>
          </div>
          <p className="muted small" style={{ margin: '6px 0 0' }}>Breaks per episode applies instantly. Sensitivity and the edge margin need a re-analyze.</p>
        </Disclosure>
      </div>

      {measured > 0 && (
        <div className="panel">
          <div className="toolbar" style={{ marginBottom: 6 }}>
            <h2>2. Check the picks</h2>
            <span className="muted small">Gold marks are where ads will go. Click a grey tick to use that fade instead, or click a gold mark to drop it. Episodes the tool was unsure about come first.</span>
          </div>
          {plan.groups.map((g) => <Group key={`${g.season}|${g.bucket}`} g={g} settings={settings} edits={edits} blacksByRel={blacksByRel} effectivePicks={effectivePicks} togglePick={togglePick} setOff={setOff} />)}
          {plan.skipped.length > 0 && <Disclosure label={`${plan.skipped.length} left alone`}><div className="recipe" style={{ gap: 2 }}>{plan.skipped.map((s) => <div key={s.rel} className="small muted"><span className="mono">{s.rel.split('/').pop()}</span> · {s.why}</div>)}</div></Disclosure>}
        </div>
      )}

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 6 }}><h2>3. Lock it in</h2></div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="btn primary" disabled={busy || planned.length === 0} onClick={() => save('plan')}>Save these breaks{dirty ? ' (edited)' : ''}</button>
          <span className="muted small">or, if it just isn't getting this show right:</span>
          <button className="btn sm" disabled={busy} onClick={() => save('timed')} title="No break points; the channel format's timed fallback places the ads">Timed breaks instead</button>
          <button className="btn sm" disabled={busy} onClick={() => save('none')} title="Play every episode straight through">No breaks at all</button>
          {ours > 0 && <button className="btn sm" disabled={busy} onClick={() => save('embedded')}>Keep the old tool's chapters</button>}
          {decided.length > 0 && <button className="btn sm" disabled={busy} onClick={() => save('clear')} title="Forget every decision; the files' own chapters stand again">Forget decisions</button>}
          <div className="grow" />
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <button className="btn sm" disabled={busy} onClick={() => fileRef.current?.click()} title="A breaks file you wrote yourself, in the shape described in docs/breaks.md">Upload a breaks file</button>
        </div>
        {msg && <p className="small" style={{ margin: '8px 0 0' }}>{msg}</p>}
      </div>
    </div>
  );
}

function Group({ g, settings, edits, blacksByRel, effectivePicks, togglePick, setOff }: { g: GroupPlan; settings: Partial<DetectSettings>; edits: Record<string, Edit>; blacksByRel: Map<string, BlackRow[]>; effectivePicks: (e: EpisodePlan) => number[]; togglePick: (e: EpisodePlan, ms: number) => void; setOff: (e: EpisodePlan, off?: Edit['off']) => void }) {
  const quiet = settings.quiet ?? DEFAULT_DETECT.quiet, loud = settings.loud ?? DEFAULT_DETECT.loud;
  const rows = [...g.episodes].sort((a, b) => Number(!!b.flags.length || !!b.skipped) - Number(!!a.flags.length || !!a.skipped) || a.rel.localeCompare(b.rel));
  return (
    <div className="brk-season">
      <div className="brk-season-head">
        <b>{g.season === '(root)' ? 'Episodes' : g.season}</b>
        <span className="muted small">{g.bucket === 1 ? 'shorts' : g.bucket === 2 ? '22-minute episodes' : `${Math.round(g.bucket * 11.5)}-minute files`} · {describeGroup(g)}</span>
      </div>
      {rows.map((e) => {
        const off = edits[e.rel]?.off;
        const picks = effectivePicks(e);
        return (
          <div key={e.rel} className={`brk-row${off ? ' off' : ''}`}>
            <div className="brk-name" title={e.rel}>{e.flags.length > 0 && <span className="badge warn" title={e.flags.join('; ')}>?</span>}{e.rel.split('/').pop()}</div>
            <EpisodeBar e={e} blacks={blacksByRel.get(e.rel) ?? []} picks={picks} quiet={quiet} loud={loud} onTick={(ms) => togglePick(e, ms)} />
            <div className="brk-picks mono small">{off ? off === 'none' ? 'no breaks' : 'timed' : picks.length ? picks.map((p) => mmss(p / 1000)).join(' ') : e.skipped ?? '-'}</div>
            <div className="brk-actions">
              <button className={`chip${off === 'none' ? ' on' : ''}`} onClick={() => setOff(e, off === 'none' ? undefined : 'none')} title="Play this one straight through">none</button>
              <button className={`chip${off === 'timed' ? ' on' : ''}`} onClick={() => setOff(e, off === 'timed' ? undefined : 'timed')} title="Let the format's timed fallback place the ads">timed</button>
            </div>
            {(e.flags.length > 0 || e.notes.length > 0) && <div className="brk-why muted small">{[...e.flags, ...e.notes].join(' · ')}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** One episode as a bar: every measured fade as a tick (taller = quieter), picks as gold marks. */
function EpisodeBar({ e, blacks, picks, quiet, loud, onTick }: { e: EpisodePlan; blacks: BlackRow[]; picks: number[]; quiet: number; loud: number; onTick: (ms: number) => void }) {
  return (
    <div className="brk-bar" title={fmtDuration(e.durationMs)}>
      {blacks.map((b) => { const ms = Math.round(b.t * 1000); const on = picks.some((p) => Math.abs(p - ms) < 500); return <i key={b.t} className={`tick${b.db <= quiet ? ' quiet' : b.db > loud ? ' loud' : ''}${on ? ' on' : ''}`} style={{ left: `${(ms / e.durationMs) * 100}%` }} title={`${mmss(b.t)} · ${b.dur.toFixed(1)}s · ${b.db.toFixed(0)} dB`} onClick={() => onTick(ms)} />; })}
      {picks.filter((p) => !blacks.some((b) => Math.abs(b.t * 1000 - p) < 500)).map((p) => <i key={p} className="tick on manual" style={{ left: `${(p / e.durationMs) * 100}%` }} title={`${mmss(p / 1000)} (by hand)`} onClick={() => onTick(p)} />)}
    </div>
  );
}

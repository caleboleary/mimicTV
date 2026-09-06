import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import {
  newChannelAnchorMs, visibleLibrary, DEFAULT_PROGRAM_MIN_MS, DEFAULT_PROGRAM_MAX_MS, MIN, HOUR,
  type Channel, type Checkpoint, type Clock, type CompactBlock, type Library, type Pool, type MediaKind,
} from '@mimictv/core';

const LIBRARY_KEY = 'mimictv-library';

/** What the service last wrote for Next: the blocks behind the playout files, and where the next publish continues from. */
export interface Published {
  at: number | null;
  checkpoints: Record<string, Checkpoint | undefined>;
  timelines: Record<string, CompactBlock[] | undefined>;
}

export function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function dateStart(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getTime();
}

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface State {
  library: Library;
  librarySource: string;
  pools: Pool[];
  clocks: Clock[];
  channels: Channel[];
  /** Folder paths the rest of the app never sees or schedules. Prefix match. */
  hiddenFolders: string[];
  selectedChannelId: string;
  previewDate: string;
  /** Undefined until the service has answered; the preview then falls back to simulating from scratch. */
  published?: Published;
  /** Next as reached from this network (Setup), for the M3U/XMLTV links and the in-app preview. */
  nextUrl: string;
  setNextUrl(url: string): void;
  hideFolder(path: string): void;
  unhideFolder(path: string): void;
  selectChannel(id: string): void;
  setPreviewDate(iso: string): void;
  updateClock(id: string, patch: (c: Clock) => Clock): void;
  addClock(clock: Clock): void;
  removeClock(id: string): void;
  updatePool(id: string, patch: (p: Pool) => Pool): void;
  addPool(pool: Pool): void;
  removePool(id: string): void;
  updateChannel(id: string, patch: (c: Channel) => Channel): void;
  addChannel(channel: Channel): void;
  removeChannel(id: string): void;
  /** Scaffold a channel with an inline show pool, a default format, and break pools. Returns its id. */
  createChannel(): string;
  duplicateChannel(id: string): string;
  /** Add a time band to a channel: a new owned clock copied from `fromClockId`. */
  addBand(channelId: string, startMinute: number, fromClockId: string): void;
  removeBand(channelId: string, index: number): void;
  /** Add a fixed show: a band with an end time, its own (empty) show list, and a copy of `fromClockId` as format. */
  addFixedShow(channelId: string, startMinute: number, durationMin: number, fromClockId: string): void;
  /** Turn an inline pool into a shared collection. */
  promotePool(poolId: string, name: string): void;
  /** Copy a shared pool into a channel as a private pool and return the copy's id. */
  detachPool(poolId: string, channelId: string): string;
  /** Create an inline pool for a break role and return its id. */
  createInlinePool(channelId: string, kind: MediaKind): string;
  setLibrary(library: Library, source: string): void;
  patchLibrary(fn: (lib: Library) => Library): void;
  replaceRules(rules: { pools: Pool[]; clocks: Clock[]; channels: Channel[] }): void;
}

function initial() {
  return {
    library: { shows: [], items: [] } as Library,
    librarySource: '',
    pools: [] as Pool[],
    clocks: [] as Clock[],
    channels: [] as Channel[],
    hiddenFolders: [] as string[],
    selectedChannelId: '',
    previewDate: isoDate(Date.now()),
    nextUrl: '',
  };
}

function newInterstitialPool(kind: MediaKind, ownerChannelId: string | undefined, channelName: string): Pool {
  const base = { id: uid(`pool-${kind}`), ownerChannelId, filter: { kinds: [kind] } };
  if (kind === 'commercial') return { ...base, name: `${channelName} commercials`, selection: 'random', noRepeatMs: HOUR };
  if (kind === 'network-id') return { ...base, name: `${channelName} IDs`, selection: 'shuffle' };
  if (kind === 'bumper') return { ...base, name: `${channelName} bumpers`, selection: 'shuffle' };
  return { ...base, name: `${channelName} filler`, selection: 'random', noRepeatMs: 30 * MIN };
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...initial(),
      selectChannel: (id) => set({ selectedChannelId: id }),
      setPreviewDate: (iso) => set({ previewDate: iso }),
      setNextUrl: (nextUrl) => set({ nextUrl }),
      hideFolder: (path) => set((s) => ({ hiddenFolders: s.hiddenFolders.includes(path) ? s.hiddenFolders : [...s.hiddenFolders, path] })),
      unhideFolder: (path) => set((s) => ({ hiddenFolders: s.hiddenFolders.filter((h) => h !== path) })),
      updateClock: (id, patch) => set((s) => ({ clocks: s.clocks.map((c) => (c.id === id ? patch(c) : c)) })),
      addClock: (clock) => set((s) => ({ clocks: [...s.clocks, clock] })),
      removeClock: (id) => set((s) => ({ clocks: s.clocks.filter((c) => c.id !== id) })),
      updatePool: (id, patch) => set((s) => ({ pools: s.pools.map((p) => (p.id === id ? patch(p) : p)) })),
      addPool: (pool) => set((s) => ({ pools: [...s.pools, pool] })),
      removePool: (id) => set((s) => ({ pools: s.pools.filter((p) => p.id !== id) })),
      updateChannel: (id, patch) => set((s) => ({ channels: s.channels.map((c) => (c.id === id ? patch(c) : c)) })),
      addChannel: (channel) => set((s) => ({ channels: [...s.channels, channel] })),
      removeChannel: (id) => set((s) => ({
        channels: s.channels.filter((c) => c.id !== id),
        pools: s.pools.filter((p) => p.ownerChannelId !== id),
        clocks: s.clocks.filter((c) => c.ownerChannelId !== id),
        selectedChannelId: s.selectedChannelId === id ? (s.channels.find((c) => c.id !== id)?.id ?? '') : s.selectedChannelId,
      })),

      createChannel: () => {
        const s = get();
        const id = uid('ch');
        const n = Math.max(0, ...s.channels.map((c) => Number(c.number) || 0)) + 1;
        const name = `Channel ${n}`;
        const shared = (kind: MediaKind) => s.pools.find((p) => !p.ownerChannelId && p.filter.kinds?.length === 1 && p.filter.kinds[0] === kind);
        const showPool: Pool = {
          id: uid('pool-shows'), ownerChannelId: id, name: `${name} shows`,
          filter: { kinds: ['episode'], showIds: [], excludeTags: ['unnumbered', 'special', 'extra'], minDurationMs: DEFAULT_PROGRAM_MIN_MS, maxDurationMs: DEFAULT_PROGRAM_MAX_MS },
          selection: 'shows-shuffled-episodes-in-order',
        };
        const extra: Pool[] = [];
        const pick = (kind: MediaKind) => { const sp = shared(kind); if (sp) return sp.id; const p = newInterstitialPool(kind, id, name); extra.push(p); return p.id; };
        const ads = pick('commercial'), ids = pick('network-id'), filler = pick('filler');
        const clock: Clock = {
          id: uid('clock'), ownerChannelId: id, name: 'All day',
          program: { poolId: showPool.id, targetMs: 22 * MIN, toleranceMs: 4 * MIN, allowMultiple: true },
          breaks: { atChapters: true, fallback: { mode: 'interval', everyMs: 8 * MIN }, betweenPrograms: 1, poolId: ads, equalize: true, midTargetMs: 2 * MIN, maxItems: 0 },
          networkId: { enabled: true, poolId: ids, nearMinutes: [0, 30], windowMs: 3 * MIN },
          pad: { toMinutes: 30, poolId: filler },
        };
        const channel: Channel = {
          id, number: String(n), name, tvgId: `mimic.${n}`, group: 'mimicTV',
          dayparts: [{ startMinute: 0, clockId: clock.id }], anchorMs: newChannelAnchorMs(), seed: id,
        };
        set({ pools: [...s.pools, showPool, ...extra], clocks: [...s.clocks, clock], channels: [...s.channels, channel], selectedChannelId: id });
        return id;
      },

      duplicateChannel: (srcId) => {
        const s = get();
        const src = s.channels.find((c) => c.id === srcId);
        if (!src) return srcId;
        const id = uid('ch');
        const n = Math.max(0, ...s.channels.map((c) => Number(c.number) || 0)) + 1;
        const poolMap = new Map<string, string>();
        const newPools: Pool[] = [];
        const clonePool = (pid: string) => {
          const p = s.pools.find((x) => x.id === pid);
          if (!p || p.ownerChannelId !== srcId) return pid; // shared: keep reference
          if (poolMap.has(pid)) return poolMap.get(pid)!;
          const copy: Pool = { ...structuredClone(p), id: uid('pool'), ownerChannelId: id };
          poolMap.set(pid, copy.id); newPools.push(copy);
          return copy.id;
        };
        const newClocks: Clock[] = [];
        const dayparts = src.dayparts.map((d) => {
          const c = s.clocks.find((x) => x.id === d.clockId);
          if (!c) return d;
          const copy: Clock = { ...structuredClone(c), id: uid('clock'), ownerChannelId: id };
          copy.program.poolId = clonePool(copy.program.poolId);
          copy.breaks.poolId = clonePool(copy.breaks.poolId);
          copy.networkId.poolId = clonePool(copy.networkId.poolId);
          copy.pad.poolId = clonePool(copy.pad.poolId);
          newClocks.push(copy);
          return { ...d, clockId: copy.id };
        });
        const channel: Channel = { ...structuredClone(src), id, number: String(n), name: `${src.name} (copy)`, tvgId: `mimic.${n}`, dayparts, seed: id };
        set({ pools: [...s.pools, ...newPools], clocks: [...s.clocks, ...newClocks], channels: [...s.channels, channel], selectedChannelId: id });
        return id;
      },

      addBand: (channelId, startMinute, fromClockId) => {
        const s = get();
        const from = s.clocks.find((c) => c.id === fromClockId);
        if (!from) return;
        const copy: Clock = { ...structuredClone(from), id: uid('clock'), ownerChannelId: channelId, name: `${String(Math.floor(startMinute / 60)).padStart(2, '0')}:00 band` };
        set({
          clocks: [...s.clocks, copy],
          channels: s.channels.map((c) => c.id === channelId ? { ...c, dayparts: [...c.dayparts, { startMinute, clockId: copy.id }].sort((a, b) => a.startMinute - b.startMinute) } : c),
        });
      },

      addFixedShow: (channelId, startMinute, durationMin, fromClockId) => {
        const s = get();
        const from = s.clocks.find((c) => c.id === fromClockId);
        const ch = s.channels.find((c) => c.id === channelId);
        if (!from || !ch) return;
        const label = `${String(Math.floor(startMinute / 60)).padStart(2, '0')}:${String(startMinute % 60).padStart(2, '0')}`;
        const pool: Pool = {
          id: uid('pool-fixed'), ownerChannelId: channelId, name: `Fixed show at ${label}`,
          filter: { kinds: ['episode'], showIds: [], excludeTags: ['unnumbered', 'special', 'extra'], minDurationMs: DEFAULT_PROGRAM_MIN_MS, maxDurationMs: DEFAULT_PROGRAM_MAX_MS },
          selection: 'shows-shuffled-episodes-in-order',
        };
        const clock: Clock = { ...structuredClone(from), id: uid('clock'), ownerChannelId: channelId, name: `Fixed show ${label}`, program: { ...from.program, poolId: pool.id } };
        const endMinute = Math.min(24 * 60, startMinute + durationMin);
        set({
          pools: [...s.pools, pool],
          clocks: [...s.clocks, clock],
          channels: s.channels.map((c) => c.id === channelId ? { ...c, dayparts: [...c.dayparts, { startMinute, endMinute, clockId: clock.id }].sort((a, b) => a.startMinute - b.startMinute) } : c),
        });
      },

      removeBand: (channelId, index) => set((s) => {
        const ch = s.channels.find((c) => c.id === channelId);
        if (!ch || ch.dayparts.length <= 1) return {};
        const removed = ch.dayparts[index];
        const stillUsed = ch.dayparts.some((d, i) => i !== index && d.clockId === removed?.clockId);
        const clock = s.clocks.find((c) => c.id === removed?.clockId);
        const dropClock = !stillUsed && clock?.ownerChannelId === channelId;
        // A fixed show's private show list goes with it when no other band uses it.
        const poolStillUsed = (pid: string) => s.clocks.some((c) => c.id !== clock?.id && c.program.poolId === pid);
        const dropPool = dropClock && clock && s.pools.find((p) => p.id === clock.program.poolId)?.ownerChannelId === channelId && !poolStillUsed(clock.program.poolId) ? clock.program.poolId : undefined;
        return {
          channels: s.channels.map((c) => c.id === channelId ? { ...c, dayparts: c.dayparts.filter((_, i) => i !== index) } : c),
          clocks: dropClock ? s.clocks.filter((c) => c.id !== clock!.id) : s.clocks,
          pools: dropPool ? s.pools.filter((p) => p.id !== dropPool) : s.pools,
        };
      }),

      promotePool: (poolId, name) => set((s) => ({ pools: s.pools.map((p) => (p.id === poolId ? { ...p, ownerChannelId: undefined, name } : p)) })),

      detachPool: (poolId, channelId) => {
        const s = get();
        const p = s.pools.find((x) => x.id === poolId);
        if (!p) return poolId;
        const copy: Pool = { ...structuredClone(p), id: uid('pool'), ownerChannelId: channelId, name: `${p.name} (private)` };
        set({ pools: [...s.pools, copy] });
        return copy.id;
      },

      createInlinePool: (channelId, kind) => {
        const s = get();
        const ch = s.channels.find((c) => c.id === channelId);
        const p = newInterstitialPool(kind, channelId, ch?.name ?? 'Channel');
        set({ pools: [...s.pools, p] });
        return p.id;
      },

      setLibrary: (library, source) => {
        idbSet(LIBRARY_KEY, { library, source }).catch(() => {});
        set({ library, librarySource: source });
      },
      patchLibrary: (fn) => {
        const s0 = get();
        const library = fn(s0.library);
        idbSet(LIBRARY_KEY, { library, source: s0.librarySource }).catch(() => {});
        set({ library });
      },
      replaceRules: (rules) => set({ ...rules, selectedChannelId: rules.channels[0]?.id ?? '' }),
    }),
    {
      name: 'mimictv',
      version: 1,
      partialize: (s) => ({
        pools: s.pools, clocks: s.clocks, channels: s.channels, hiddenFolders: s.hiddenFolders, librarySource: s.librarySource,
        selectedChannelId: s.selectedChannelId, previewDate: s.previewDate,
      }),
    },
  ),
);

/**
 * One-time tidy for rules made before ownership existed: a pool or clock used by exactly
 * one channel becomes that channel's private one. Sharing is by promotion from then on.
 */
function adoptSingleUseRules() {
  const s = useStore.getState();
  if (s.pools.every((p) => p.ownerChannelId) && s.clocks.every((c) => c.ownerChannelId)) return;
  const clockOwners = new Map<string, Set<string>>();
  for (const ch of s.channels) for (const d of ch.dayparts) clockOwners.set(d.clockId, new Set([...(clockOwners.get(d.clockId) ?? []), ch.id]));
  const poolOwners = new Map<string, Set<string>>();
  for (const c of s.clocks) {
    const owners = clockOwners.get(c.id) ?? new Set<string>();
    for (const pid of [c.program.poolId, c.breaks.poolId, c.networkId.poolId, c.pad.poolId]) {
      if (!pid) continue;
      poolOwners.set(pid, new Set([...(poolOwners.get(pid) ?? []), ...owners]));
    }
  }
  const clocks = s.clocks.map((c) => {
    const owners = clockOwners.get(c.id);
    return !c.ownerChannelId && owners?.size === 1 ? { ...c, ownerChannelId: [...owners][0] } : c;
  });
  const pools = s.pools.map((p) => {
    const owners = poolOwners.get(p.id);
    return !p.ownerChannelId && owners?.size === 1 ? { ...p, ownerChannelId: [...owners][0] } : p;
  });
  if (clocks.some((c, i) => c !== s.clocks[i]) || pools.some((p, i) => p !== s.pools[i])) useStore.setState({ clocks, pools });
}

/** Episode pools made before length limits existed get the defaults once; a user can clear them afterwards. */
function applyDefaultProgramRange() {
  const s = useStore.getState();
  const isEpisodePool = (p: Pool) => p.filter.kinds?.length === 1 && p.filter.kinds[0] === 'episode';
  const needs = (p: Pool) => isEpisodePool(p) && p.filter.minDurationMs === undefined && p.filter.maxDurationMs === undefined;
  if (!s.pools.some(needs)) return;
  useStore.setState({ pools: s.pools.map((p) => (needs(p) ? { ...p, filter: { ...p.filter, minDurationMs: DEFAULT_PROGRAM_MIN_MS, maxDurationMs: DEFAULT_PROGRAM_MAX_MS } } : p)) });
}

type RulesSnapshot = Pick<State, 'pools' | 'clocks' | 'channels' | 'hiddenFolders' | 'selectedChannelId' | 'previewDate' | 'librarySource'>;

/** The library as the rest of the app should see it: without hidden folders. */
export function useLibrary(): Library {
  const library = useStore((s) => s.library);
  const hidden = useStore((s) => s.hiddenFolders);
  return useMemo(() => visibleLibrary(library, hidden), [library, hidden]);
}

async function getJson<T>(url: string): Promise<T | undefined> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : undefined;
  } catch { return undefined; }
}

let syncing = false;
let serverRulesSeen = false;
let serverLibSeen = false;

/**
 * Load state before first render: data/*.json on the service first, then IndexedDB /
 * localStorage. Afterwards mirror every change back to the service.
 */
export async function hydrateLibrary(): Promise<void> {
  syncing = true;
  try {
    const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000));
    const [serverRules, serverLib, published, settings, saved] = await Promise.all([
      getJson<RulesSnapshot>('/api/rules'),
      getJson<{ library: Library; source: string }>('/api/library'),
      getJson<Published>('/api/published'),
      getJson<{ next?: { publicUrl?: string } }>('/api/settings'),
      Promise.race([idbGet<{ library: Library; source: string }>(LIBRARY_KEY), timeout]).catch(() => undefined),
    ]);
    serverRulesSeen = !!serverRules?.pools;
    serverLibSeen = !!serverLib?.library;
    if (serverRules?.pools) useStore.setState({ ...serverRules, hiddenFolders: serverRules.hiddenFolders ?? [] });
    if (published?.checkpoints) useStore.setState({ published });
    if (settings?.next?.publicUrl) useStore.setState({ nextUrl: settings.next.publicUrl });
    const lib = serverLib?.library ? serverLib : saved?.library ? saved : undefined;
    if (lib) {
      useStore.setState({ library: lib.library, librarySource: lib.source });
      idbSet(LIBRARY_KEY, lib).catch(() => {});
    }
  } finally {
    syncing = false;
  }

  adoptSingleUseRules();
  applyDefaultProgramRange();
  const s0 = useStore.getState();
  if (!serverRulesSeen) {
    const rules: RulesSnapshot = { pools: s0.pools, clocks: s0.clocks, channels: s0.channels, hiddenFolders: s0.hiddenFolders, selectedChannelId: s0.selectedChannelId, previewDate: s0.previewDate, librarySource: s0.librarySource };
    fetch('/api/rules', { method: 'PUT', body: JSON.stringify(rules), headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  }
  if (!serverLibSeen && s0.library.items.length > 0) {
    fetch('/api/library', { method: 'PUT', body: JSON.stringify({ library: s0.library, source: s0.librarySource }), headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  }

  // Follow the service's publishes so the preview keeps matching what Next is playing.
  setInterval(async () => {
    const status = await getJson<{ last: { at: number } | null }>('/api/publish/status');
    if (!status || status.last?.at === useStore.getState().published?.at) return;
    const published = await getJson<Published>('/api/published');
    if (published?.checkpoints) useStore.setState({ published });
  }, 10_000);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastRules = '';
  let lastLib: Library | undefined = useStore.getState().library;
  useStore.subscribe((s) => {
    if (syncing) return;
    const rules: RulesSnapshot = { pools: s.pools, clocks: s.clocks, channels: s.channels, hiddenFolders: s.hiddenFolders, selectedChannelId: s.selectedChannelId, previewDate: s.previewDate, librarySource: s.librarySource };
    const json = JSON.stringify(rules);
    const libChanged = s.library !== lastLib;
    if (json === lastRules && !libChanged) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (json !== lastRules) {
        lastRules = json;
        fetch('/api/rules', { method: 'PUT', body: json, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
      }
      if (libChanged) {
        lastLib = s.library;
        fetch('/api/library', { method: 'PUT', body: JSON.stringify({ library: s.library, source: s.librarySource }), headers: { 'Content-Type': 'application/json' } }).catch(() => {});
      }
    }, 600);
  });
}

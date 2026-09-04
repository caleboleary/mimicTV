import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import {
  buildStubLibrary, defaultChannels, defaultClocks, defaultPools,
  type Channel, type Clock, type Library, type Pool,
} from '@mimictv/core';

const LIBRARY_KEY = 'mimictv-library';

export function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function dateStart(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getTime();
}

interface State {
  library: Library;
  /** 'stub' or the name of the imported probe file. */
  librarySource: string;
  pools: Pool[];
  clocks: Clock[];
  channels: Channel[];
  selectedChannelId: string;
  previewDate: string;
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
  setLibrary(library: Library, source: string): void;
  /** Append items to the current library (or remove by predicate), persisting the result. */
  patchLibrary(fn: (lib: Library) => Library): void;
  replaceRules(rules: { pools: Pool[]; clocks: Clock[]; channels: Channel[] }): void;
  useStubLibrary(): void;
  reset(): void;
}

function initial() {
  const channels = defaultChannels();
  return {
    library: buildStubLibrary(),
    librarySource: 'stub',
    pools: defaultPools(),
    clocks: defaultClocks(),
    channels,
    selectedChannelId: channels[0]!.id,
    previewDate: isoDate(channels[0]!.anchorMs + 24 * 3600 * 1000),
  };
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      ...initial(),
      selectChannel: (id) => set({ selectedChannelId: id }),
      setPreviewDate: (iso) => set({ previewDate: iso }),
      updateClock: (id, patch) => set((s) => ({ clocks: s.clocks.map((c) => (c.id === id ? patch(c) : c)) })),
      addClock: (clock) => set((s) => ({ clocks: [...s.clocks, clock] })),
      removeClock: (id) => set((s) => ({ clocks: s.clocks.filter((c) => c.id !== id) })),
      updatePool: (id, patch) => set((s) => ({ pools: s.pools.map((p) => (p.id === id ? patch(p) : p)) })),
      addPool: (pool) => set((s) => ({ pools: [...s.pools, pool] })),
      removePool: (id) => set((s) => ({ pools: s.pools.filter((p) => p.id !== id) })),
      updateChannel: (id, patch) => set((s) => ({ channels: s.channels.map((c) => (c.id === id ? patch(c) : c)) })),
      addChannel: (channel) => set((s) => ({ channels: [...s.channels, channel] })),
      removeChannel: (id) => set((s) => ({ channels: s.channels.filter((c) => c.id !== id) })),
      setLibrary: (library, source) => {
        idbSet(LIBRARY_KEY, { library, source }).catch(() => {});
        set({ library, librarySource: source });
      },
      patchLibrary: (fn) => {
        const s0 = useStore.getState();
        const library = fn(s0.library);
        if (s0.librarySource !== 'stub') idbSet(LIBRARY_KEY, { library, source: s0.librarySource }).catch(() => {});
        set({ library });
      },
      replaceRules: (rules) => set({ ...rules, selectedChannelId: rules.channels[0]?.id ?? '' }),
      useStubLibrary: () => {
        idbDel(LIBRARY_KEY).catch(() => {});
        set({ library: buildStubLibrary(), librarySource: 'stub' });
      },
      reset: () => { idbDel(LIBRARY_KEY).catch(() => {}); set(initial()); },
    }),
    {
      name: 'mimictv-poc',
      version: 1,
      partialize: (s) => ({
        pools: s.pools, clocks: s.clocks, channels: s.channels, librarySource: s.librarySource,
        selectedChannelId: s.selectedChannelId, previewDate: s.previewDate,
      }),
    },
  ),
);

type RulesSnapshot = Pick<State, 'pools' | 'clocks' | 'channels' | 'selectedChannelId' | 'previewDate' | 'librarySource'>;

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
 * Load state before first render. Order of preference: data/*.json on the dev server
 * (shared with the CLI and any other browser), then IndexedDB / localStorage, then the stub.
 * Afterwards, mirror every change back to the dev server.
 */
export async function hydrateLibrary(): Promise<void> {
  syncing = true;
  try {
    const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000));
    const [serverRules, serverLib, saved] = await Promise.all([
      getJson<RulesSnapshot>('/api/rules'),
      getJson<{ library: Library; source: string }>('/api/library'),
      Promise.race([idbGet<{ library: Library; source: string }>(LIBRARY_KEY), timeout]).catch(() => undefined),
    ]);
    serverRulesSeen = !!serverRules?.pools;
    serverLibSeen = !!serverLib?.library;
    if (serverRules?.pools) useStore.setState(serverRules);
    const lib = serverLib?.library ? serverLib : saved?.library ? saved : undefined;
    if (lib) {
      useStore.setState({ library: lib.library, librarySource: lib.source });
      idbSet(LIBRARY_KEY, lib).catch(() => {});
    } else if (useStore.getState().librarySource !== 'stub') {
      useStore.setState({ librarySource: 'stub' });
    }
  } finally {
    syncing = false;
  }

  // First run against an empty data/ folder: push what the browser already has.
  const s0 = useStore.getState();
  if (!serverRulesSeen) {
    const rules: RulesSnapshot = { pools: s0.pools, clocks: s0.clocks, channels: s0.channels, selectedChannelId: s0.selectedChannelId, previewDate: s0.previewDate, librarySource: s0.librarySource };
    fetch('/api/rules', { method: 'PUT', body: JSON.stringify(rules), headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  }
  if (!serverLibSeen && s0.librarySource !== 'stub') {
    fetch('/api/library', { method: 'PUT', body: JSON.stringify({ library: s0.library, source: s0.librarySource }), headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastRules = '';
  let lastLib: Library | undefined = useStore.getState().library;
  useStore.subscribe((s) => {
    if (syncing) return;
    const rules: RulesSnapshot = { pools: s.pools, clocks: s.clocks, channels: s.channels, selectedChannelId: s.selectedChannelId, previewDate: s.previewDate, librarySource: s.librarySource };
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
        const body = s.librarySource === 'stub' ? '{}' : JSON.stringify({ library: s.library, source: s.librarySource });
        fetch('/api/library', { method: 'PUT', body, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
      }
    }, 600);
  });
}

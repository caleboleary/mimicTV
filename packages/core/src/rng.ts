/** Small deterministic PRNG so previews are stable and tests are reproducible. */
export interface Rng {
  next(): number; // [0, 1)
  state(): number;
  int(maxExclusive: number): number;
  pick<T>(arr: readonly T[]): T;
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    state: () => a,
    int: (max) => Math.floor(next() * max),
    pick: (arr) => {
      if (arr.length === 0) throw new Error('pick from empty array');
      return arr[Math.floor(next() * arr.length)] as (typeof arr)[number];
    },
  };
}

export function rngFor(seed: string, state?: number): Rng {
  return mulberry32(state ?? hashString(seed));
}

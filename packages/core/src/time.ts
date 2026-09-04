export const SEC = 1000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function ceilToMinutes(ms: number, minutes: number): number {
  const step = minutes * MIN;
  const d = new Date(ms);
  // Work relative to local midnight so :30 boundaries respect local time and DST.
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const rel = ms - midnight;
  return midnight + Math.ceil(rel / step) * step;
}

export function localMidnight(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function minutesPastHour(ms: number): number {
  const d = new Date(ms);
  return d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;
}

/** Distance (ms) from `ms` to the nearest boundary at any of `nearMinutes` past the hour. */
export function distanceToBoundary(ms: number, nearMinutes: number[]): number {
  const mph = minutesPastHour(ms);
  let best = Infinity;
  for (const m of nearMinutes) {
    for (const cand of [m, m + 60, m - 60]) {
      best = Math.min(best, Math.abs(mph - cand));
    }
  }
  return best * MIN;
}

export function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtClockSec(ms: number): string {
  const d = new Date(ms);
  return `${fmtClock(ms)}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** RFC3339 with the local UTC offset, e.g. 2026-04-13T00:24:21.527-05:00 */
export function toRfc3339Local(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${oh}:${om}`
  );
}

/** Compact ISO 8601 used by Next for playout filenames: 20260413T000000.000000000-0500 */
export function toCompactIso(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}000000` +
    `${sign}${oh}${om}`
  );
}

/** XMLTV timestamp: 20260630153000 -0600 */
export function toXmltvTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())} ${sign}${oh}${om}`
  );
}

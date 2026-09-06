import { hashString, type MediaItem, type Role } from '@mimictv/core';

export function showHue(showId: string): number {
  return hashString(showId) % 360;
}

export function entryColor(item: MediaItem, role: Role): string {
  if (role === 'program') {
    const h = item.showId ? showHue(item.showId) : 200;
    return `hsl(${h} 55% 52%)`;
  }
  if (role === 'commercial') return 'var(--ad)';
  if (role === 'network-id') return 'var(--accent)';
  if (role === 'bumper') return 'var(--bumper)';
  return 'var(--filler)';
}

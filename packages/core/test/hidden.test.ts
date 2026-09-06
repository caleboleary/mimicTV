import { describe, it, expect } from 'vitest';
import { hiddenBy, visibleLibrary, showFolder } from '../src/index';
import { buildStubLibrary } from './fixtures/stub-library';

const library = buildStubLibrary();

describe('hidden folders', () => {
  it('matches whole path segments only', () => {
    expect(hiddenBy('/media/TV/Wednesday/S01E01.mkv', ['/media/TV/Wednesday'])).toBe('/media/TV/Wednesday');
    expect(hiddenBy('/media/TV/Wednesday Extras/x.mkv', ['/media/TV/Wednesday'])).toBeUndefined();
    expect(hiddenBy('/media/TV/Wednesday/S01E01.mkv', ['/media/TV/'])).toBe('/media/TV/');
  });

  it('drops items under hidden folders and shows left with nothing', () => {
    const show = library.shows[0]!;
    const folder = showFolder(library, show.id)!;
    expect(folder).toBeTruthy();
    const vis = visibleLibrary(library, [folder]);
    expect(vis.items.some((i) => i.showId === show.id)).toBe(false);
    expect(vis.shows.some((s) => s.id === show.id)).toBe(false);
    expect(vis.items.length).toBeLessThan(library.items.length);
    expect(visibleLibrary(library, [])).toBe(library);
  });
});

describe('fmtDuration', () => {
  it('switches to days past 24 hours', async () => {
    const { fmtDuration, HOUR, MIN, DAY } = await import('../src/index');
    expect(fmtDuration(22 * MIN + 5000)).toBe('22:05');
    expect(fmtDuration(3 * HOUR + 4 * MIN + 9000)).toBe('3:04:09');
    expect(fmtDuration(DAY)).toBe('1d 0h');
    expect(fmtDuration(3 * DAY + 14 * HOUR + 59 * MIN)).toBe('3d 14h');
  });
});

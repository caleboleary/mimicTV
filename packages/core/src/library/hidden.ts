/**
 * Hidden folders: paths the user never wants scheduled. Hiding is a rule, not a library edit,
 * so a rescan cannot undo it and every consumer (preview, publish, live breaks) sees the same
 * library minus those items.
 */
import type { Library } from '../types';

const under = (path: string, folder: string) => path === folder || path.startsWith(folder.endsWith('/') ? folder : folder + '/');

/** The hidden folder that covers this path, if any. */
export function hiddenBy(path: string, hiddenFolders: string[]): string | undefined {
  return hiddenFolders.find((h) => under(path, h));
}

/** The library without items under hidden folders; shows with no items left go too. */
export function visibleLibrary(library: Library, hiddenFolders: string[]): Library {
  if (hiddenFolders.length === 0) return library;
  const items = library.items.filter((i) => !hiddenBy(i.path, hiddenFolders));
  const showsLeft = new Set(items.map((i) => i.showId).filter(Boolean));
  return { shows: library.shows.filter((s) => showsLeft.has(s.id)), items };
}

/** Deepest folder that holds every item of a show: what "hide this show" hides. */
export function showFolder(library: Library, showId: string): string | undefined {
  const dirs = library.items.filter((i) => i.showId === showId).map((i) => i.path.split(/[\\/]+/).slice(0, -1));
  if (dirs.length === 0) return undefined;
  let common = dirs[0]!;
  for (const d of dirs) { let n = 0; while (n < common.length && n < d.length && common[n] === d[n]) n++; common = common.slice(0, n); }
  return common.length > 1 ? common.join('/') : undefined;
}

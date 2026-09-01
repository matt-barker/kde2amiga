import type { IconKind } from '../newicons/diskObject';

/**
 * Guesses the Amiga icon type from a KDE icon's name and category.
 *
 * Order matters: "user-trash-symbolic" is both trash-like and user-like, and
 * "folder-trash" is both folder-like and trash-like. Trash is tested first so
 * those land on 'trashcan' rather than 'drawer'.
 *
 * Always overridable in the UI — this only picks the starting value.
 */
export function inferIconKind(name: string, category: string): IconKind {
  const haystack = `${category}/${name}`.toLowerCase();

  if (/trash|wastebasket|bin\b/.test(haystack)) return 'trashcan';
  if (/folder|directory|user-home|\bhome\b/.test(haystack)) return 'drawer';
  if (/drive|disk|floppy|media-optical|harddisk/.test(haystack)) return 'disk';

  return 'project';
}

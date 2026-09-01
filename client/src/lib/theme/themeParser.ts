import type JSZip from 'jszip';

export interface IconVariant {
  name: string;
  category: string;
  sizePx: number;
  format: 'svg' | 'png';
  zipPath: string;
}

export interface IconGroup {
  name: string;
  variants: IconVariant[];
}

type Marker = { kind: 'scalable' } | { kind: 'sized'; sizePx: number };

function parseMarker(segment: string): Marker | null {
  if (segment.toLowerCase() === 'scalable') return { kind: 'scalable' };
  // "48x48" or a bare "48" (some themes use a plain size directory)
  const match = segment.match(/^(\d+)(?:x\d+)?$/i);
  if (match) return { kind: 'sized', sizePx: Number(match[1]) };
  return null;
}

/**
 * Finds the rightmost directory segment that looks like a size/scalable
 * marker. The rightmost one is always the real marker: a wrapper directory
 * earlier in the path (a repo name, a version number, ...) could itself look
 * numeric, but the marker that actually governs the icon's size/category
 * split is the one closest to the filename.
 */
function locateMarker(dirSegments: string[]): { index: number; marker: Marker } | null {
  for (let i = dirSegments.length - 1; i >= 0; i--) {
    const marker = parseMarker(dirSegments[i]);
    if (marker) return { index: i, marker };
  }
  return null;
}

/**
 * Parses one zip entry path into an IconVariant, if it matches the recognised
 * KDE icon-theme layout. Tolerates any number of leading wrapper directories
 * (a GitHub tarball's repo-name prefix, a theme-name directory inside it,
 * "breeze/", etc.) by locating the rightmost size/scalable marker segment
 * and deriving the category from its position, rather than by counting
 * leading directories:
 *  - "<size>x<size>/<category>[/<subcategory>]/<name>.ext" and a bare
 *    "<size>/" directory: everything after the marker is the category,
 *    however deeply nested;
 *  - "<category>/<size>x<size>/<name>.ext": the marker is the last
 *    directory segment, so the category is the single segment before it;
 *  - "scalable/..." follows the same two shapes, and only ever matches
 *    ".svg" files.
 */
function parseIconPath(relativePath: string): IconVariant | null {
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const fileMatch = segments[segments.length - 1].match(/^(.+)\.(svg|png)$/i);
  if (!fileMatch) return null;
  const [, name, extRaw] = fileMatch;
  const ext = extRaw.toLowerCase() as 'svg' | 'png';
  const dirSegments = segments.slice(0, -1);

  const found = locateMarker(dirSegments);
  if (!found) return null;
  const { index, marker } = found;

  let categorySegments: string[];
  if (index === dirSegments.length - 1) {
    // Marker is the final directory segment ("<category>/<size>"): the
    // category is the single segment immediately before it, so any deeper
    // wrapper directories before that are correctly dropped.
    if (index === 0) return null;
    categorySegments = [dirSegments[index - 1]];
  } else {
    // Marker is followed by the category (and any subcategories); anything
    // before the marker is wrapper, however many levels deep.
    categorySegments = dirSegments.slice(index + 1);
  }

  if (categorySegments.length === 0) return null;
  if (marker.kind === 'scalable' && ext !== 'svg') return null;

  return {
    name,
    category: categorySegments.join('/'),
    sizePx: marker.kind === 'scalable' ? 0 : marker.sizePx,
    format: ext,
    zipPath: relativePath,
  };
}

/**
 * Ranks a variant for display. Scalable SVG first, then larger SVG, then larger raster.
 *
 * This replaces the old `shouldReplace`, which used the same preference to *discard*
 * every other variant. Discarding is what hid the fact that `folder-wine` ships as a
 * full-colour icon under apps/ and a near-white symbolic glyph under places/ — the
 * user could only ever see whichever the zip happened to yield first.
 */
function variantRank(variant: IconVariant): [number, number] {
  const formatRank = variant.format === 'svg' ? 0 : 1;
  const size = variant.sizePx === 0 ? Number.POSITIVE_INFINITY : variant.sizePx;
  return [formatRank, -size];
}

export async function parseTheme(zip: JSZip): Promise<IconGroup[]> {
  const byName = new Map<string, IconGroup>();

  zip.forEach((relativePath) => {
    const variant = parseIconPath(relativePath);
    if (!variant) return;

    let group = byName.get(variant.name);
    if (!group) {
      group = { name: variant.name, variants: [] };
      byName.set(variant.name, group);
    }
    group.variants.push(variant);
  });

  for (const group of byName.values()) {
    group.variants.sort((a, b) => {
      const [af, as] = variantRank(a);
      const [bf, bs] = variantRank(b);
      return af - bf || as - bs;
    });
  }

  return Array.from(byName.values());
}

/**
 * The smallest source drawing we are willing to pick when a larger one is available.
 *
 * Every icon in a KDE theme of this shape is an SVG, so the size directory does not
 * record resolution — it records how much *linework* the artist put in. A 22px drawing
 * is a deliberately simplified glyph. Since conversion downscales to a 32px Amiga icon
 * (`JobConfig.outputSizePx`'s default), starting from a 22px drawing throws away detail
 * that a 48px drawing of the same icon still has. Deliberately a constant rather than
 * wired to the live `outputSizePx`: re-picking every tile when the user nudges the
 * output size would churn the gallery, and the floor is about which drawing the theme
 * considers detailed, not about the exact output geometry.
 */
const MIN_DETAIL_PX = 32;

/** Scalable SVGs have `sizePx` 0 but render at any size, so they sort as the largest. */
function effectiveSize(variant: IconVariant): number {
  return variant.sizePx === 0 ? Number.POSITIVE_INFINITY : variant.sizePx;
}

function compareRank(a: IconVariant, b: IconVariant): number {
  const [af, as] = variantRank(a);
  const [bf, bs] = variantRank(b);
  return af - bf || as - bs;
}

/**
 * Chooses the single variant that best represents an icon set in the gallery.
 *
 * Two signals, in this order:
 *
 * 1. **The deepest category ladder wins.** Measured against
 *    `Slot-Symbolic-Dark-Icons` (8,381 sets), only 169 sets span more than one
 *    category at all — but in those, a category shipping the icon at six sizes is the
 *    theme's own artwork, while a lone orphan in another category is typically a stale
 *    legacy copy the theme never updated. `start-here-kde` is the case in point: six
 *    sizes under places/, one abandoned 48px copy under apps/.
 * 2. **Never below `MIN_DETAIL_PX` when something better exists.** Ladder depth alone
 *    picked `places/22` over `apps/48` for `folder-wine` and 104 sets like it, trading
 *    away linework for a structural signal. When the deep-ladder pick is under the
 *    floor and a variant at or above it exists anywhere in the set, the best such
 *    variant wins instead. The floor only ever redirects *upward*: a set whose every
 *    variant is tiny keeps its theme-intent pick.
 *
 * Ties in ladder depth fall through to variant rank and then to category name, so the
 * pick never depends on the order the zip happened to yield entries in.
 *
 * The full `IconGroup.variants` list is left untouched — this picks a default to show,
 * it does not discard the alternatives. Discarding is what once hid `folder-wine`'s two
 * quite different drawings from the user entirely.
 */
export function pickBestVariant(group: IconGroup): IconVariant {
  const byCategory = new Map<string, IconVariant[]>();
  for (const variant of group.variants) {
    const existing = byCategory.get(variant.category);
    if (existing) existing.push(variant);
    else byCategory.set(variant.category, [variant]);
  }

  const categories = Array.from(byCategory, ([category, variants]) => ({
    category,
    variants,
    best: variants.reduce((a, b) => (compareRank(a, b) <= 0 ? a : b)),
  }));

  categories.sort(
    (a, b) =>
      b.variants.length - a.variants.length ||
      compareRank(a.best, b.best) ||
      a.category.localeCompare(b.category),
  );

  const deepest = categories[0].best;
  if (effectiveSize(deepest) >= MIN_DETAIL_PX) return deepest;

  const detailed = group.variants.filter((v) => effectiveSize(v) >= MIN_DETAIL_PX);
  if (detailed.length === 0) return deepest;
  return detailed.reduce((a, b) => (compareRank(a, b) <= 0 ? a : b));
}

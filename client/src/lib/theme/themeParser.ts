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

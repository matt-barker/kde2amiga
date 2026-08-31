import type JSZip from 'jszip';

export interface ThemeIcon {
  name: string;
  category: string;
  sizePx: number;
  format: 'svg' | 'png';
  zipPath: string;
}

type Marker = { kind: 'scalable' } | { kind: 'sized'; sizePx: number };

function parseMarker(segment: string): Marker | null {
  if (segment.toLowerCase() === 'scalable') return { kind: 'scalable' };
  // "48x48" or a bare "48" (some themes use a plain size directory)
  const match = segment.match(/^(\d+)(?:x\d+)?$/i);
  if (match) return { kind: 'sized', sizePx: Number(match[1]) };
  return null;
}

function matchDirSegments(
  dirSegments: string[],
  name: string,
  ext: 'svg' | 'png',
  zipPath: string,
): ThemeIcon | null {
  if (dirSegments.length < 2) return null;

  const firstMarker = parseMarker(dirSegments[0]);
  const lastMarker = parseMarker(dirSegments[dirSegments.length - 1]);

  let marker: Marker;
  let categorySegments: string[];
  if (firstMarker) {
    marker = firstMarker;
    categorySegments = dirSegments.slice(1);
  } else if (lastMarker) {
    marker = lastMarker;
    categorySegments = dirSegments.slice(0, -1);
  } else {
    return null;
  }

  if (categorySegments.length === 0) return null;
  if (marker.kind === 'scalable' && ext !== 'svg') return null;

  return {
    name,
    category: categorySegments.join('/'),
    sizePx: marker.kind === 'scalable' ? 0 : marker.sizePx,
    format: ext,
    zipPath,
  };
}

/**
 * Parses one zip entry path into a ThemeIcon, if it matches the recognised
 * KDE icon-theme layout. Tolerates:
 *  - an optional single leading theme directory (e.g. "Papirus-master/…"),
 *  - "<size>x<size>/<category>/<name>.ext", "<category>/<size>x<size>/<name>.ext",
 *    and a bare "<size>/" directory,
 *  - "scalable/<category>/<name>.svg" with "scalable" in either position,
 *  - nested category paths ("places/subdir/name.svg" -> category "places/subdir").
 */
function parseIconPath(relativePath: string): ThemeIcon | null {
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const fileMatch = segments[segments.length - 1].match(/^(.+)\.(svg|png)$/i);
  if (!fileMatch) return null;
  const [, name, extRaw] = fileMatch;
  const ext = extRaw.toLowerCase() as 'svg' | 'png';
  const dirSegments = segments.slice(0, -1);

  const direct = matchDirSegments(dirSegments, name, ext, relativePath);
  if (direct) return direct;

  // Tolerate one leading theme directory (GitHub tarball/zip prefixes, "breeze/", etc.)
  if (dirSegments.length > 1) {
    return matchDirSegments(dirSegments.slice(1), name, ext, relativePath);
  }
  return null;
}

function shouldReplace(existing: ThemeIcon | undefined, candidate: ThemeIcon): boolean {
  if (!existing) return true;
  if (existing.format === 'svg') return false; // scalable already wins, never displaced
  if (candidate.format === 'svg') return true; // scalable beats any raster
  return candidate.sizePx > existing.sizePx; // among rasters, prefer the larger source
}

export async function parseTheme(zip: JSZip): Promise<ThemeIcon[]> {
  const byKey = new Map<string, ThemeIcon>();

  zip.forEach((relativePath) => {
    const icon = parseIconPath(relativePath);
    if (!icon) return;

    const key = `${icon.category}/${icon.name}`;
    const existing = byKey.get(key);
    if (shouldReplace(existing, icon)) byKey.set(key, icon);
  });

  return Array.from(byKey.values());
}

import type JSZip from 'jszip';

export interface ThemeIcon {
  name: string;
  category: string;
  sizePx: number;
  format: 'svg' | 'png';
  zipPath: string;
}

const SCALABLE_RE = /^scalable\/([^/]+)\/([^/]+)\.svg$/i;
const SIZED_RE = /^(\d+)x\d+\/([^/]+)\/([^/]+)\.(svg|png)$/i;

export async function parseTheme(zip: JSZip): Promise<ThemeIcon[]> {
  const byKey = new Map<string, ThemeIcon>();

  zip.forEach((relativePath) => {
    const scalableMatch = relativePath.match(SCALABLE_RE);
    if (scalableMatch) {
      const [, category, name] = scalableMatch;
      const key = `${category}/${name}`;
      byKey.set(key, { name, category, sizePx: 0, format: 'svg', zipPath: relativePath });
      return;
    }

    const sizedMatch = relativePath.match(SIZED_RE);
    if (sizedMatch) {
      const [, size, category, name, ext] = sizedMatch;
      const key = `${category}/${name}`;
      const existing = byKey.get(key);
      if (existing?.format === 'svg') return; // SVG already wins
      byKey.set(key, {
        name,
        category,
        sizePx: Number(size),
        format: ext.toLowerCase() as 'svg' | 'png',
        zipPath: relativePath,
      });
    }
  });

  return Array.from(byKey.values());
}

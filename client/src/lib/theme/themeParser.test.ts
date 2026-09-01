import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseTheme, type IconGroup } from './themeParser';

/** Flattens every group's variants into one list, for tests that only care about totals. */
function flatten(groups: IconGroup[]) {
  return groups.flatMap((g) => g.variants);
}

describe('parseTheme', () => {
  it('finds scalable SVG icons under <category>/<name>.svg', async () => {
    const zip = new JSZip();
    zip.file('index.theme', '[Icon Theme]\nName=Test');
    zip.file('scalable/places/folder.svg', '<svg></svg>');
    zip.file('scalable/apps/firefox.svg', '<svg></svg>');

    const groups = await parseTheme(zip);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.name).sort()).toEqual(['firefox', 'folder']);
    expect(flatten(groups)[0].format).toBe('svg');
  });

  it('finds fixed-size PNG icons under <size>/<category>/<name>.png', async () => {
    const zip = new JSZip();
    zip.file('index.theme', '[Icon Theme]\nName=Test');
    zip.file('48x48/places/folder.png', new Uint8Array([1, 2, 3]));

    const groups = await parseTheme(zip);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants).toHaveLength(1);
    expect(groups[0].variants[0]).toMatchObject({
      name: 'folder',
      category: 'places',
      sizePx: 48,
      format: 'png',
    });
  });

  it('groups the scalable SVG and a fixed PNG of the same icon together, SVG first', async () => {
    const zip = new JSZip();
    zip.file('index.theme', '[Icon Theme]\nName=Test');
    zip.file('scalable/places/folder.svg', '<svg></svg>');
    zip.file('48x48/places/folder.png', new Uint8Array([1, 2, 3]));

    const groups = await parseTheme(zip);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants).toHaveLength(2);
    expect(groups[0].variants[0].format).toBe('svg');
    expect(groups[0].variants[1].format).toBe('png');
  });

  it('tolerates a top-level theme directory wrapping the whole archive', async () => {
    const zip = new JSZip();
    zip.file('Papirus-master/index.theme', '[Icon Theme]\nName=Papirus');
    zip.file('Papirus-master/scalable/places/folder.svg', '<svg></svg>');
    zip.file('Papirus-master/48x48/apps/firefox.png', new Uint8Array([1, 2, 3]));

    const groups = await parseTheme(zip);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.name).sort()).toEqual(['firefox', 'folder']);
  });

  it('finds icons ordered <category>/<size>x<size>/<name>.ext (Breeze layout)', async () => {
    const zip = new JSZip();
    zip.file('places/48x48/folder.png', new Uint8Array([1, 2, 3]));

    const groups = await parseTheme(zip);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants[0]).toMatchObject({
      name: 'folder',
      category: 'places',
      sizePx: 48,
      format: 'png',
    });
  });

  it('accepts a bare numeric size directory ("48/" rather than "48x48/")', async () => {
    const zip = new JSZip();
    zip.file('48/places/folder.png', new Uint8Array([1, 2, 3]));

    const groups = await parseTheme(zip);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants[0]).toMatchObject({ name: 'folder', sizePx: 48 });
  });

  it('accepts "<category>/scalable/<name>.svg" (scalable trailing the category)', async () => {
    const zip = new JSZip();
    zip.file('places/scalable/folder.svg', '<svg></svg>');

    const groups = await parseTheme(zip);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants[0]).toMatchObject({ name: 'folder', category: 'places', format: 'svg' });
  });

  it('joins nested category segments rather than dropping them', async () => {
    const zip = new JSZip();
    zip.file('scalable/places/subdir/folder.svg', '<svg></svg>');

    const groups = await parseTheme(zip);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants[0]).toMatchObject({ name: 'folder', category: 'places/subdir' });
  });

  it('when both candidates are sized rasters, orders the larger sizePx first regardless of zip order', async () => {
    const zip = new JSZip();
    zip.file('16x16/places/folder.png', new Uint8Array([1]));
    zip.file('256x256/places/folder.png', new Uint8Array([1, 2, 3, 4]));

    const groups = await parseTheme(zip);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants.map((v) => v.sizePx)).toEqual([256, 16]);
  });

  it('orders the larger sizePx first even when the larger one appears first in the zip', async () => {
    const zip = new JSZip();
    zip.file('256x256/places/folder.png', new Uint8Array([1, 2, 3, 4]));
    zip.file('16x16/places/folder.png', new Uint8Array([1]));

    const groups = await parseTheme(zip);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants.map((v) => v.sizePx)).toEqual([256, 16]);
  });

  describe('locating the size/scalable marker rather than counting wrapper directories', () => {
    it.each([
      { path: '48x48/apps/firefox.svg', category: 'apps', sizePx: 48 },
      { path: 'Papirus/48x48/apps/firefox.svg', category: 'apps', sizePx: 48 },
      {
        path: 'papirus-icon-theme-master/Papirus/48x48/apps/firefox.svg',
        category: 'apps',
        sizePx: 48,
      },
      { path: 'scalable/places/folder.svg', category: 'places', sizePx: 0 },
      {
        path: 'repo-master/Theme/scalable/places/sub/x.svg',
        category: 'places/sub',
        sizePx: 0,
      },
      { path: 'breeze/actions/22/go-up.svg', category: 'actions', sizePx: 22 },
      { path: 'actions/22/go-up.svg', category: 'actions', sizePx: 22 },
      { path: 'hicolor/48x48/apps/x.svg', category: 'apps', sizePx: 48 },
    ])('$path -> category "$category", sizePx $sizePx', async ({ path, category, sizePx }) => {
      const zip = new JSZip();
      zip.file(path, path.endsWith('.svg') ? '<svg></svg>' : new Uint8Array([1, 2, 3]));

      const groups = await parseTheme(zip);
      expect(groups).toHaveLength(1);
      expect(groups[0].variants[0]).toMatchObject({ category, sizePx });
    });

    it('tolerates a two-level wrapper (GitHub repo dir + theme dir), as a real Papirus download has', async () => {
      const zip = new JSZip();
      zip.file('papirus-icon-theme-master/Papirus/index.theme', '[Icon Theme]\nName=Papirus');
      zip.file('papirus-icon-theme-master/Papirus/scalable/places/folder.svg', '<svg></svg>');
      zip.file(
        'papirus-icon-theme-master/Papirus/48x48/apps/firefox.png',
        new Uint8Array([1, 2, 3]),
      );

      const groups = await parseTheme(zip);
      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.name).sort()).toEqual(['firefox', 'folder']);
      expect(
        flatten(groups).every((v) => v.category === 'places' || v.category === 'apps'),
      ).toBe(true);
    });

    it('drops the wrapper directory from the category in Breeze-style <category>/<size> layout', async () => {
      const zip = new JSZip();
      zip.file('breeze/actions/22/go-up.svg', '<svg></svg>');

      const groups = await parseTheme(zip);
      expect(groups).toHaveLength(1);
      expect(groups[0].variants[0].category).toBe('actions');
    });
  });
});

describe('variant grouping', () => {
  it('keeps every variant of a name instead of collapsing to one', async () => {
    const zip = new JSZip();
    zip.file('t/apps/48/folder-wine.svg', '<svg/>');
    zip.file('t/places/22/folder-wine.svg', '<svg/>');
    zip.file('t/places/16/folder-wine.svg', '<svg/>');

    const groups = await parseTheme(zip);

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('folder-wine');
    expect(groups[0].variants.map((v) => v.zipPath).sort()).toEqual([
      't/apps/48/folder-wine.svg',
      't/places/16/folder-wine.svg',
      't/places/22/folder-wine.svg',
    ]);
  });

  it('orders variants best-first: svg before png, larger before smaller', async () => {
    const zip = new JSZip();
    zip.file('t/places/16/folder.png', 'x');
    zip.file('t/places/48/folder.png', 'x');
    zip.file('t/places/32/folder.svg', '<svg/>');
    zip.file('t/places/scalable/folder.svg', '<svg/>');

    const [group] = await parseTheme(zip);

    expect(group.variants.map((v) => `${v.format}:${v.sizePx}`)).toEqual([
      'svg:0', // scalable ranks above any fixed size
      'svg:32',
      'png:48',
      'png:16',
    ]);
  });

  it('groups by name across categories', async () => {
    const zip = new JSZip();
    zip.file('t/apps/48/a.svg', '<svg/>');
    zip.file('t/places/48/b.svg', '<svg/>');

    const groups = await parseTheme(zip);

    expect(groups.map((g) => g.name).sort()).toEqual(['a', 'b']);
  });
});

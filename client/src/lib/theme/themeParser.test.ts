import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseTheme, pickBestVariant, type IconGroup, type IconVariant } from './themeParser';

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

describe('pickBestVariant', () => {
  function variant(category: string, sizePx: number, format: 'svg' | 'png' = 'svg'): IconVariant {
    return {
      name: 'icon',
      category,
      sizePx,
      format,
      zipPath: `${category}/${sizePx === 0 ? 'scalable' : sizePx}/icon.${format}`,
    };
  }
  function group(...variants: IconVariant[]): IconGroup {
    return { name: 'icon', variants };
  }

  it('returns the only variant when there is just one', () => {
    const only = variant('apps', 48);
    expect(pickBestVariant(group(only))).toBe(only);
  });

  it('prefers the category offering the deepest ladder of sizes', () => {
    // The real `start-here-kde` shape: the theme's own icon ships at six sizes under
    // places/, while a stale legacy copy sits alone under apps/. The deep ladder is
    // the theme's intent; the orphan is what the theme never got round to updating.
    const best = variant('places', 96);
    const picked = pickBestVariant(
      group(
        variant('apps', 48),
        variant('places', 16),
        variant('places', 22),
        variant('places', 32),
        variant('places', 48),
        variant('places', 64),
        best,
      ),
    );
    expect(picked).toBe(best);
  });

  it('refuses a sub-32px pick when a larger source exists in a shallower category', () => {
    // The real `folder-wine` shape. places/ has the deeper ladder, but its best is a
    // 22px glyph — deliberately simplified linework. Every icon in this theme is an
    // SVG, so the size directory records *design detail*, not resolution: downscaling
    // the 22px drawing to a 32px Amiga icon throws away detail the 48px drawing has.
    const picked = pickBestVariant(
      group(variant('places', 16), variant('places', 22), variant('apps', 48)),
    );
    expect(picked.zipPath).toBe('apps/48/icon.svg');
  });

  it('keeps the deepest-ladder pick when it already meets the size floor', () => {
    // `folder-new`: actions/ has the deeper ladder and its best is 32px, which clears
    // the floor — so the shallower apps/48 does not get to override it.
    const picked = pickBestVariant(
      group(
        variant('actions', 16),
        variant('actions', 22),
        variant('actions', 24),
        variant('actions', 32),
        variant('places', 22),
        variant('apps', 48),
      ),
    );
    expect(picked.zipPath).toBe('actions/32/icon.svg');
  });

  it('keeps the deepest-ladder pick when nothing in the group reaches the floor', () => {
    // The floor only ever redirects to a *better* source. With no 32px-or-larger
    // variant anywhere, there is nothing better to redirect to, so theme intent stands.
    const picked = pickBestVariant(
      group(variant('places', 16), variant('places', 22), variant('apps', 24)),
    );
    expect(picked.zipPath).toBe('places/22/icon.svg');
  });

  it('breaks a ladder-depth tie on the better-ranked variant', () => {
    // 30 of this theme's multi-category sets tie on depth; without a tiebreak the
    // winner would depend on zip iteration order.
    const picked = pickBestVariant(
      group(variant('apps', 32), variant('apps', 48), variant('status', 32), variant('status', 64)),
    );
    expect(picked.zipPath).toBe('status/64/icon.svg');
  });

  it('breaks a depth-and-rank tie on category name, so the pick is deterministic', () => {
    const forwards = group(variant('preferences', 32), variant('apps', 32));
    const backwards = group(variant('apps', 32), variant('preferences', 32));
    expect(pickBestVariant(forwards).zipPath).toBe('apps/32/icon.svg');
    expect(pickBestVariant(backwards).zipPath).toBe('apps/32/icon.svg');
  });

  it('treats a scalable SVG as clearing the size floor', () => {
    // sizePx 0 means scalable, which renders at any size — the one case where a
    // numerically small size is the best possible source rather than the worst.
    const picked = pickBestVariant(group(variant('places', 0), variant('apps', 48)));
    expect(picked.zipPath).toBe('places/scalable/icon.svg');
  });

  it('prefers an SVG over a larger raster within the chosen category', () => {
    const picked = pickBestVariant(
      group(variant('apps', 48, 'svg'), variant('apps', 96, 'png')),
    );
    expect(picked.zipPath).toBe('apps/48/icon.svg');
  });
});

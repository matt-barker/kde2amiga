import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseTheme } from './themeParser';

describe('parseTheme', () => {
  it('finds scalable SVG icons under <category>/<name>.svg', async () => {
    const zip = new JSZip();
    zip.file('index.theme', '[Icon Theme]\nName=Test');
    zip.file('scalable/places/folder.svg', '<svg></svg>');
    zip.file('scalable/apps/firefox.svg', '<svg></svg>');

    const icons = await parseTheme(zip);
    expect(icons).toHaveLength(2);
    expect(icons.map((i) => i.name).sort()).toEqual(['firefox', 'folder']);
    expect(icons[0].format).toBe('svg');
  });

  it('finds fixed-size PNG icons under <size>/<category>/<name>.png', async () => {
    const zip = new JSZip();
    zip.file('index.theme', '[Icon Theme]\nName=Test');
    zip.file('48x48/places/folder.png', new Uint8Array([1, 2, 3]));

    const icons = await parseTheme(zip);
    expect(icons).toHaveLength(1);
    expect(icons[0]).toMatchObject({ name: 'folder', category: 'places', sizePx: 48, format: 'png' });
  });

  it('prefers the scalable SVG over a fixed PNG of the same icon', async () => {
    const zip = new JSZip();
    zip.file('index.theme', '[Icon Theme]\nName=Test');
    zip.file('scalable/places/folder.svg', '<svg></svg>');
    zip.file('48x48/places/folder.png', new Uint8Array([1, 2, 3]));

    const icons = await parseTheme(zip);
    expect(icons).toHaveLength(1);
    expect(icons[0].format).toBe('svg');
  });

  it('tolerates a top-level theme directory wrapping the whole archive', async () => {
    const zip = new JSZip();
    zip.file('Papirus-master/index.theme', '[Icon Theme]\nName=Papirus');
    zip.file('Papirus-master/scalable/places/folder.svg', '<svg></svg>');
    zip.file('Papirus-master/48x48/apps/firefox.png', new Uint8Array([1, 2, 3]));

    const icons = await parseTheme(zip);
    expect(icons).toHaveLength(2);
    expect(icons.map((i) => i.name).sort()).toEqual(['firefox', 'folder']);
  });

  it('finds icons ordered <category>/<size>x<size>/<name>.ext (Breeze layout)', async () => {
    const zip = new JSZip();
    zip.file('places/48x48/folder.png', new Uint8Array([1, 2, 3]));

    const icons = await parseTheme(zip);
    expect(icons).toHaveLength(1);
    expect(icons[0]).toMatchObject({ name: 'folder', category: 'places', sizePx: 48, format: 'png' });
  });

  it('accepts a bare numeric size directory ("48/" rather than "48x48/")', async () => {
    const zip = new JSZip();
    zip.file('48/places/folder.png', new Uint8Array([1, 2, 3]));

    const icons = await parseTheme(zip);
    expect(icons).toHaveLength(1);
    expect(icons[0]).toMatchObject({ name: 'folder', sizePx: 48 });
  });

  it('accepts "<category>/scalable/<name>.svg" (scalable trailing the category)', async () => {
    const zip = new JSZip();
    zip.file('places/scalable/folder.svg', '<svg></svg>');

    const icons = await parseTheme(zip);
    expect(icons).toHaveLength(1);
    expect(icons[0]).toMatchObject({ name: 'folder', category: 'places', format: 'svg' });
  });

  it('joins nested category segments rather than dropping them', async () => {
    const zip = new JSZip();
    zip.file('scalable/places/subdir/folder.svg', '<svg></svg>');

    const icons = await parseTheme(zip);
    expect(icons).toHaveLength(1);
    expect(icons[0]).toMatchObject({ name: 'folder', category: 'places/subdir' });
  });

  it('when both candidates are sized rasters, keeps the larger sizePx regardless of zip order', async () => {
    const zip = new JSZip();
    zip.file('16x16/places/folder.png', new Uint8Array([1]));
    zip.file('256x256/places/folder.png', new Uint8Array([1, 2, 3, 4]));

    const icons = await parseTheme(zip);
    expect(icons).toHaveLength(1);
    expect(icons[0].sizePx).toBe(256);
  });

  it('keeps the larger sizePx even when the larger one appears first', async () => {
    const zip = new JSZip();
    zip.file('256x256/places/folder.png', new Uint8Array([1, 2, 3, 4]));
    zip.file('16x16/places/folder.png', new Uint8Array([1]));

    const icons = await parseTheme(zip);
    expect(icons).toHaveLength(1);
    expect(icons[0].sizePx).toBe(256);
  });
});

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
});

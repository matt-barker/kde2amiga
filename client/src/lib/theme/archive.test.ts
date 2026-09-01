import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { loadArchive } from './archive';
import { parseTheme } from './themeParser';
import { buildTar } from './untar.test';

// Held in a variable: a literal `new URL(..., import.meta.url)` is rewritten by Vite
// into an asset URL, which breaks the lookup under vitest.
const archiveModuleUrl = import.meta.url;

const BLOCK = 512;

function nullPad(bytes: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  out.set(bytes.subarray(0, length));
  return out;
}

function octal(value: number, length: number): Uint8Array {
  const str = value.toString(8).padStart(length - 1, '0') + '\0';
  return new TextEncoder().encode(str);
}

function writeField(header: Uint8Array, offset: number, value: string | Uint8Array, length: number) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  header.set(nullPad(bytes, length), offset);
}

function makeHeader(opts: { name: string; size: number; typeflag: string }): Uint8Array {
  const header = new Uint8Array(BLOCK);
  writeField(header, 0, opts.name, 100);
  writeField(header, 124, octal(opts.size, 12), 12);
  writeField(header, 156, opts.typeflag, 1);
  writeField(header, 257, 'ustar\0', 6);
  header.set(new TextEncoder().encode('        '), 148);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += header[i];
  const checksum = sum.toString(8).padStart(6, '0') + '\0 ';
  writeField(header, 148, checksum, 8);
  return header;
}

function padTo512(data: Uint8Array): Uint8Array {
  const rem = data.length % BLOCK;
  if (rem === 0) return data;
  const out = new Uint8Array(data.length + (BLOCK - rem));
  out.set(data);
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function fileEntry(name: string, contents: string | Uint8Array): Uint8Array {
  const data = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents;
  const header = makeHeader({ name, size: data.length, typeflag: '0' });
  return concat([header, padTo512(data)]);
}

function dirEntry(name: string): Uint8Array {
  return concat([makeHeader({ name, size: 0, typeflag: '5' })]);
}

// GNU long-name entry: typeflag 'L' carries the full path of the *next*
// entry as its data, used here to exercise names past the 100-byte field.
function gnuLongNameEntry(fullPath: string): Uint8Array {
  const data = new TextEncoder().encode(fullPath + '\0');
  const header = makeHeader({ name: './@LongLink', size: data.length, typeflag: 'L' });
  return concat([header, padTo512(data)]);
}

function buildTarGz(entries: Uint8Array[]): Uint8Array {
  const tar = concat([...entries, new Uint8Array(BLOCK * 2)]);
  return new Uint8Array(gzipSync(Buffer.from(tar)));
}

// Two wrapper levels, as a real GitHub download of Papirus actually unpacks:
// the repo directory ("Papirus-master"), then the theme directory ("Papirus")
// -- the repo ships Papirus, Papirus-Dark and Papirus-Light side by side.
function buildThemeTarGz(): Uint8Array {
  const longMimeCategoryPath =
    'Papirus-master/Papirus/48x48/mimetypes/' +
    'a-very-long-nested-subdirectory-name-that-pushes-the-path-well-past-the-classic-100-byte-tar-name-field/' +
    'x-office-document.png';

  return buildTarGz([
    fileEntry('Papirus-master/Papirus/index.theme', '[Icon Theme]\nName=Papirus'),
    dirEntry('Papirus-master/Papirus/scalable/'),
    fileEntry('Papirus-master/Papirus/scalable/places/folder.svg', '<svg></svg>'),
    fileEntry('Papirus-master/Papirus/48x48/apps/firefox.png', new Uint8Array([1, 2, 3, 4])),
    fileEntry('Papirus-master/LICENSE', 'GPL-3.0'),
    gnuLongNameEntry(longMimeCategoryPath),
    fileEntry('x-office-document.png', new Uint8Array([5, 6, 7, 8])),
  ]);
}

describe('loadArchive', () => {
  it('loads a plain zip unchanged', async () => {
    const zip = new JSZip();
    zip.file('scalable/places/folder.svg', '<svg></svg>');
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    const loaded = await loadArchive(bytes);
    const icons = await parseTheme(loaded);
    expect(icons).toHaveLength(1);
    expect(icons[0].name).toBe('folder');
  });

  it('loads a gzipped tarball, expanding it into an equivalent JSZip', async () => {
    const tarGz = buildThemeTarGz();
    const loaded = await loadArchive(tarGz);

    // index.theme should have made it through the memory filter.
    expect(await loaded.file('Papirus-master/Papirus/index.theme')?.async('string')).toContain(
      'Papirus',
    );

    // The non-icon LICENSE file must be dropped by the memory filter.
    expect(loaded.file('Papirus-master/LICENSE')).toBeNull();

    // The directory entry must not have produced a JSZip file entry.
    expect(loaded.file('Papirus-master/Papirus/scalable/')).toBeNull();

    const icons = await parseTheme(loaded);
    const byName = Object.fromEntries(icons.map((i) => [i.name, i]));
    expect(Object.keys(byName).sort()).toEqual(['firefox', 'folder', 'x-office-document']);
    expect(byName.folder.format).toBe('svg');
    expect(byName.firefox).toMatchObject({ format: 'png', sizePx: 48 });
    expect(byName['x-office-document']).toMatchObject({ format: 'png', sizePx: 48 });
  });

  it('throws a clear error for a buffer that is neither zip nor gzip', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(loadArchive(garbage)).rejects.toThrow(/zip|gzip|archive/i);
  });

  it('accepts a ReadableStream of a gzipped tar and keeps only wanted files', async () => {
    const tar = buildTar([fileEntry('theme/48x48/apps/a.svg', '<svg/>'), fileEntry('theme/LICENSE', 'not an icon')]);
    const gzipped = new Uint8Array(
      await new Response(
        (
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(tar);
              c.close();
            },
          }) as ReadableStream<Uint8Array<ArrayBuffer>>
        ).pipeThrough(new CompressionStream('gzip')),
      ).arrayBuffer(),
    );

    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        // Two chunks, split mid-archive, to prove sniffing survives chunking.
        c.enqueue(gzipped.subarray(0, 3));
        c.enqueue(gzipped.subarray(3));
        c.close();
      },
    });

    const zip = await loadArchive(stream);

    expect(zip.file('theme/48x48/apps/a.svg')).not.toBeNull();
    expect(zip.file('theme/LICENSE')).toBeNull();
  });
});

it('reads a real .tar.xz archive and keeps only wanted files', async () => {
  const path = fileURLToPath(new URL('./__fixtures__/sample-theme.tar.xz', archiveModuleUrl));
  const bytes = new Uint8Array(readFileSync(path));

  const zip = await loadArchive(bytes);

  expect(zip.file('theme/48x48/apps/sample.svg')).not.toBeNull();
  expect(zip.file('theme/LICENSE')).toBeNull();
});

it('still rejects an archive with no recognised magic', async () => {
  await expect(loadArchive(new Uint8Array([1, 2, 3, 4, 5, 6]))).rejects.toThrow(
    'Unrecognised archive format',
  );
});

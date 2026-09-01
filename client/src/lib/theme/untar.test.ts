import { describe, it, expect } from 'vitest';
import { untar, untarStream, type TarEntry } from './untar';

const BLOCK = 512;

function nullPad(bytes: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  out.set(bytes.subarray(0, length));
  return out;
}

function octal(value: number, length: number): Uint8Array {
  // Tar size fields are octal ASCII, NUL-terminated, left-padded with '0'.
  const str = value.toString(8).padStart(length - 1, '0') + '\0';
  return new TextEncoder().encode(str);
}

function writeField(header: Uint8Array, offset: number, value: string | Uint8Array, length: number) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  header.set(nullPad(bytes, length), offset);
}

function makeHeader(opts: {
  name: string;
  size: number;
  typeflag: string;
  prefix?: string;
  ustar?: boolean;
}): Uint8Array {
  const header = new Uint8Array(BLOCK);
  writeField(header, 0, opts.name, 100);
  writeField(header, 124, octal(opts.size, 12), 12);
  writeField(header, 156, opts.typeflag, 1);
  if (opts.ustar !== false) {
    writeField(header, 257, 'ustar\0', 6);
  }
  if (opts.prefix) {
    writeField(header, 345, opts.prefix, 155);
  }
  // checksum: fill with spaces first, tar readers of this quality don't verify it,
  // but compute it properly anyway for realism.
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

function fileEntry(name: string, contents: string, opts: { prefix?: string } = {}): Uint8Array {
  const data = new TextEncoder().encode(contents);
  const header = makeHeader({ name, size: data.length, typeflag: '0', prefix: opts.prefix });
  return concat([header, padTo512(data)]);
}

function dirEntry(name: string): Uint8Array {
  const header = makeHeader({ name, size: 0, typeflag: '5' });
  return concat([header]);
}

function gnuLongNameEntry(fullPath: string): Uint8Array {
  const data = new TextEncoder().encode(fullPath + '\0');
  const header = makeHeader({ name: './@LongLink', size: data.length, typeflag: 'L' });
  return concat([header, padTo512(data)]);
}

function paxExtendedHeaderEntry(fullPath: string): Uint8Array {
  const record = `path=${fullPath}\n`;
  // PAX record format: "<len> path=value\n" where len includes itself.
  let len = record.length + 2; // guess then correct for digit-count growth
  while (`${len} ${record}`.length !== len) len++;
  const body = `${len} ${record}`;
  const data = new TextEncoder().encode(body);
  const header = makeHeader({ name: 'PaxHeaders/entry', size: data.length, typeflag: 'x' });
  return concat([header, padTo512(data)]);
}

function endOfArchive(): Uint8Array {
  return new Uint8Array(BLOCK * 2);
}

export function buildTar(entries: Uint8Array[]): Uint8Array {
  return concat([...entries, endOfArchive()]);
}

describe('untar', () => {
  it('extracts regular files with their contents', async () => {
    const tar = buildTar([fileEntry('index.theme', '[Icon Theme]\nName=Test')]);
    const files = await untar(tar);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('index.theme');
    expect(new TextDecoder().decode(files[0].data)).toBe('[Icon Theme]\nName=Test');
  });

  it('skips directory entries', async () => {
    const tar = buildTar([dirEntry('scalable/'), fileEntry('scalable/folder.svg', '<svg/>')]);
    const files = await untar(tar);
    expect(files.map((f) => f.path)).toEqual(['scalable/folder.svg']);
  });

  it('joins ustar prefix and name for long paths', async () => {
    const prefix = 'Papirus-master/Papirus/48x48/apps';
    const tar = buildTar([fileEntry('firefox.svg', '<svg/>', { prefix })]);
    const files = await untar(tar);
    expect(files[0].path).toBe('Papirus-master/Papirus/48x48/apps/firefox.svg');
  });

  it('honours a GNU long-name (typeflag L) entry for the following file', async () => {
    const longPath = 'Papirus-master/' + 'a/'.repeat(20) + 'deeply-nested-icon.svg';
    const tar = buildTar([gnuLongNameEntry(longPath), fileEntry('deeply-nested-icon.svg', '<svg/>')]);
    const files = await untar(tar);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe(longPath);
  });

  it('honours a PAX extended header (typeflag x) path record for the following file', async () => {
    const longPath = 'Papirus-master/' + 'b/'.repeat(20) + 'pax-icon.png';
    const tar = buildTar([paxExtendedHeaderEntry(longPath), fileEntry('pax-icon.png', 'PNGDATA')]);
    const files = await untar(tar);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe(longPath);
  });

  it('throws a clear error on a truncated archive', async () => {
    const header = makeHeader({ name: 'broken.svg', size: 100, typeflag: '0' });
    const tar = concat([header, new Uint8Array(10)]); // declares 100 bytes of data, has 10
    await expect(untar(tar)).rejects.toThrow(/truncated|malformed/i);
  });
});

/** Emits `bytes` in fixed-size chunks so entries straddle chunk boundaries. */
function chunkedStream(bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<TarEntry[]> {
  const out: TarEntry[] = [];
  for await (const entry of untarStream(stream)) out.push(entry);
  return out;
}

describe('untarStream', () => {
  it('reads entries whose headers and data straddle chunk boundaries', async () => {
    const tar = buildTar([fileEntry('a/one.svg', 'hello'), fileEntry('a/two.svg', 'x'.repeat(1500))]);

    // 7 is deliberately coprime with the 512-byte block size, so every header
    // and every data run is split across at least two chunks.
    const entries = await collect(chunkedStream(tar, 7));

    expect(entries.map((e) => e.path)).toEqual(['a/one.svg', 'a/two.svg']);
    expect(new TextDecoder().decode(entries[0].data)).toBe('hello');
    expect(entries[1].data.byteLength).toBe(1500);
  });

  it('yields an entry before the source stream is exhausted', async () => {
    const tar = buildTar([fileEntry('a/one.svg', 'first'), fileEntry('a/two.svg', 'second')]);

    // A ReadableStream with the default highWaterMark (1) invokes `pull()` again
    // automatically as soon as its sole buffered chunk is dequeued — regardless of
    // whether the consumer asked for more. That makes `pull()` an unreliable signal
    // for "did the consumer read ahead." Instead, count real reads issued against
    // the reader itself: the first entry (1024 bytes: header + padded data) should
    // be satisfied by a single read of the one chunk that was enqueued up front,
    // without the consumer ever needing to request a second one.
    let realReadCount = 0;
    const stalling = new ReadableStream<Uint8Array>({
      start(controller) {
        // Enough for the first entry plus its padding, then stall forever.
        controller.enqueue(tar.subarray(0, 1024));
      },
      pull() {
        // Never supplies more data; if the consumer waited on this, the test would hang.
      },
    });
    const originalGetReader = stalling.getReader.bind(stalling);
    (stalling as { getReader: typeof stalling.getReader }).getReader = (() => {
      const reader = originalGetReader();
      const originalRead = reader.read.bind(reader);
      reader.read = (...args: Parameters<typeof originalRead>) => {
        realReadCount++;
        return originalRead(...args);
      };
      return reader;
    }) as typeof stalling.getReader;

    const iterator = untarStream(stalling)[Symbol.asyncIterator]();
    const first = await iterator.next();

    expect(first.done).toBe(false);
    expect(first.value?.path).toBe('a/one.svg');
    expect(realReadCount).toBe(1); // delivered without asking the source for more
  });
});

const BLOCK_SIZE = 512;

export interface TarEntry {
  path: string;
  data: Uint8Array;
}

const TYPEFLAG_REGULAR_NUL = '\0';
const TYPEFLAG_REGULAR = '0';
const TYPEFLAG_GNU_LONGNAME = 'L';
const TYPEFLAG_PAX_EXTENDED = 'x';
const TYPEFLAG_PAX_GLOBAL = 'g';

function decodeAscii(bytes: Uint8Array): string {
  return new TextDecoder('ascii').decode(bytes);
}

function trimNul(str: string): string {
  const nulIndex = str.indexOf('\0');
  return (nulIndex === -1 ? str : str.slice(0, nulIndex)).trim();
}

function parseOctal(bytes: Uint8Array): number {
  const str = trimNul(decodeAscii(bytes)).trim();
  if (str.length === 0) return 0;
  const value = parseInt(str, 8);
  if (Number.isNaN(value) || value < 0) {
    throw new Error('Malformed tar header: invalid size field');
  }
  return value;
}

function blocksFor(byteLength: number): number {
  return Math.ceil(byteLength / BLOCK_SIZE);
}

function isZeroBlock(bytes: Uint8Array, offset: number): boolean {
  for (let i = 0; i < BLOCK_SIZE; i++) {
    if (bytes[offset + i] !== 0) return false;
  }
  return true;
}

/** Parses a single PAX extended-header record ("<len> key=value\n") stream, returning any `path` value found. */
function parsePaxPath(data: Uint8Array): string | null {
  const text = new TextDecoder('utf-8').decode(data);
  let offset = 0;
  let path: string | null = null;
  while (offset < text.length) {
    const spaceIndex = text.indexOf(' ', offset);
    if (spaceIndex === -1) break;
    const lenStr = text.slice(offset, spaceIndex);
    const len = parseInt(lenStr, 10);
    if (Number.isNaN(len) || len <= 0) break;
    const record = text.slice(offset, offset + len);
    const eq = record.indexOf('=', spaceIndex - offset);
    if (eq !== -1) {
      const key = record.slice(spaceIndex - offset + 1, eq);
      const value = record.slice(eq + 1).replace(/\n$/, '');
      if (key === 'path') path = value;
    }
    offset += len;
  }
  return path;
}

/**
 * Pulls exact byte counts out of a chunked stream. Holds only the bytes not yet
 * consumed, so peak memory is one tar entry plus one source chunk — not the archive.
 */
class ByteStream {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private chunks: Uint8Array[] = [];
  private available = 0;
  private exhausted = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  /** Exactly `n` bytes, or null at a clean end of stream. Throws on a short read. */
  async read(n: number): Promise<Uint8Array | null> {
    while (this.available < n && !this.exhausted) {
      const { done, value } = await this.reader.read();
      if (done) {
        this.exhausted = true;
        break;
      }
      this.chunks.push(value);
      this.available += value.byteLength;
    }

    if (this.available === 0) return null;
    if (this.available < n) {
      throw new Error('Malformed tar archive: truncated stream');
    }

    const out = new Uint8Array(n);
    let filled = 0;
    while (filled < n) {
      const chunk = this.chunks[0];
      const take = Math.min(chunk.byteLength, n - filled);
      out.set(chunk.subarray(0, take), filled);
      filled += take;
      if (take === chunk.byteLength) this.chunks.shift();
      else this.chunks[0] = chunk.subarray(take);
    }
    this.available -= n;
    return out;
  }

  async cancel(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
  }
}

/**
 * Streaming counterpart of `untar`. Yields each regular file as soon as its data has
 * arrived, so a 642MB archive never exists in memory at once. Handles ustar `prefix`,
 * GNU long names ('L') and PAX extended headers ('x') exactly as the buffered reader did.
 */
export async function* untarStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<TarEntry, void, undefined> {
  const source = new ByteStream(stream);
  let pendingLongName: string | null = null;

  try {
    for (;;) {
      const header = await source.read(BLOCK_SIZE);
      if (header === null) return; // clean end of stream
      if (isZeroBlock(header, 0)) return; // end-of-archive terminator

      const rawName = trimNul(decodeAscii(header.subarray(0, 100)));
      const size = parseOctal(header.subarray(124, 136));
      const typeflag = String.fromCharCode(header[156]);
      const magic = decodeAscii(header.subarray(257, 263));
      const prefix = trimNul(decodeAscii(header.subarray(345, 500)));

      const padded = blocksFor(size) * BLOCK_SIZE;
      let data: Uint8Array = new Uint8Array(0);
      if (padded > 0) {
        const block = await source.read(padded);
        if (block === null) throw new Error('Malformed tar archive: truncated file data');
        data = block.subarray(0, size);
      }

      if (typeflag === TYPEFLAG_GNU_LONGNAME) {
        pendingLongName = trimNul(decodeAscii(data)).replace(/\0+$/, '');
        continue;
      }

      if (typeflag === TYPEFLAG_PAX_EXTENDED) {
        const path = parsePaxPath(data);
        if (path) pendingLongName = path;
        continue;
      }

      if (typeflag === TYPEFLAG_PAX_GLOBAL) {
        // Global PAX headers apply defaults to all following entries; this
        // reader only cares about per-file paths, so skip them.
        continue;
      }

      if (typeflag !== TYPEFLAG_REGULAR && typeflag !== TYPEFLAG_REGULAR_NUL) {
        // Directory, symlink, or other special entry: not a file we extract.
        //
        // Known limitation, not a regression: KDE themes symlink aggressively (a whole
        // size directory aliased to another, an icon aliased to its "-symbolic" twin),
        // and typeflag '2' entries are silently dropped here rather than resolved
        // against their target. Icons that exist in a theme only as a symlink will
        // therefore not appear in the gallery at all. If an icon is missing from a
        // converted theme and it is present in the tarball, this is the first place to
        // look. Resolving links means a second pass (targets can appear after the link)
        // and is deliberately out of scope for now.
        pendingLongName = null;
        continue;
      }

      let path: string;
      if (pendingLongName) {
        path = pendingLongName;
      } else if (magic.startsWith('ustar') && prefix.length > 0) {
        path = `${prefix}/${rawName}`;
      } else {
        path = rawName;
      }
      pendingLongName = null;

      if (!path) throw new Error('Malformed tar archive: empty file name');

      yield { path, data: data.slice() };
    }
  } finally {
    await source.cancel();
  }
}

/**
 * Buffered convenience wrapper over `untarStream`, kept so callers with a whole
 * archive already in memory do not have to build a stream themselves.
 */
export async function untar(bytes: Uint8Array): Promise<TarEntry[]> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const entries: TarEntry[] = [];
  for await (const entry of untarStream(stream)) entries.push(entry);
  return entries;
}

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
 * Extracts regular files from an uncompressed tar archive. Directories and
 * other special entries are skipped. Handles ustar `prefix`, GNU long-name
 * ('L') entries, and PAX extended headers ('x') for paths that exceed the
 * classic 100-byte name field.
 */
export function untar(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let pendingLongName: string | null = null;

  while (offset < bytes.length) {
    // Fewer than a full header left: either end-of-archive padding or truncation.
    if (offset + BLOCK_SIZE > bytes.length) {
      if (isZeroTail(bytes, offset)) break;
      throw new Error('Malformed tar archive: truncated header block');
    }

    if (isZeroBlock(bytes, offset)) {
      // A single zero block could be the first of the two-block terminator,
      // or (rarely) a lone one before truncation. Either way, we're done.
      break;
    }

    const header = bytes.subarray(offset, offset + BLOCK_SIZE);
    const rawName = trimNul(decodeAscii(header.subarray(0, 100)));
    const size = parseOctal(header.subarray(124, 136));
    const typeflag = String.fromCharCode(header[156]);
    const magic = decodeAscii(header.subarray(257, 263));
    const prefix = trimNul(decodeAscii(header.subarray(345, 500)));

    offset += BLOCK_SIZE;

    const dataBlocks = blocksFor(size);
    const dataEnd = offset + dataBlocks * BLOCK_SIZE;
    if (size > 0 && offset + size > bytes.length) {
      throw new Error('Malformed tar archive: truncated file data');
    }
    const data = bytes.subarray(offset, offset + size);
    offset = dataEnd;

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

    if (!path) {
      throw new Error('Malformed tar archive: empty file name');
    }

    entries.push({ path, data: data.slice() });
  }

  return entries;
}

function isZeroTail(bytes: Uint8Array, offset: number): boolean {
  for (let i = offset; i < bytes.length; i++) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

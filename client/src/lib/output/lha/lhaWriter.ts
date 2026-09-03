import { crc16 } from './crc16';
import { lh5Compress } from './lh5';

/**
 * Writes LHA archives with level-1 headers, `-lh5-` compressed.
 *
 * The layout is copied from a level-1 archive known to work on the target — the
 * AmigaOS 3.2.3 update itself — rather than from the LHA documentation, which is
 * vaguer than the format's actual users. In particular that archive shows the
 * directory living in a type-0x02 extended header while the base header carries only
 * the basename, and it shows `0xFF` (not `\` or `/`) separating path components.
 */

export interface LhaEntry {
  path: string;
  bytes: Uint8Array;
}

/** OS identifier byte. Real Amiga archives carry 'A'; Lhasa reports it as "[Amiga]". */
const OS_AMIGA = 0x41;
/** Extended header carrying the directory the entry lives in. */
const EXT_DIRECTORY = 0x02;
/** Conventional MS-DOS "archive" attribute. Level-1 readers ignore it. */
const ATTRIBUTE = 0x20;
const HEADER_LEVEL = 1;
/** Bytes before the filename: length, checksum, method, sizes, timestamp, attribute, level, name length. */
const NAME_OFFSET = 22;

/**
 * Amiga filenames are ISO-8859-1, and the header stores a byte count rather than a
 * character count — so anything outside one byte would silently misalign every field
 * that follows it.
 */
function encodeName(name: string): Uint8Array {
  const bytes = new Uint8Array(name.length);
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code > 0xff) throw new Error(`Filename is not representable on the Amiga: ${name}`);
    bytes[i] = code;
  }
  return bytes;
}

/** Packs a date the way level-0 and level-1 headers want it: an MS-DOS FTIME word pair. */
function msdosTimestamp(date: Date): number {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const day =
    ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return ((day << 16) | time) >>> 0;
}

/** `[type][data][size of the next header]`, where the declared size counts all three. */
function extendedHeader(type: number, data: Uint8Array, nextSize: number): Uint8Array {
  const header = new Uint8Array(1 + data.length + 2);
  header[0] = type;
  header.set(data, 1);
  new DataView(header.buffer).setUint16(header.length - 2, nextSize, true);
  return header;
}

function buildEntry(entry: LhaEntry, modified: Date): Uint8Array {
  const separator = entry.path.lastIndexOf('/');
  const name = separator === -1 ? entry.path : entry.path.slice(separator + 1);
  const directory = separator === -1 ? '' : entry.path.slice(0, separator);

  const compressed = lh5Compress(entry.bytes);
  // What LhA itself does per file: keep the compressed form only when it actually paid.
  // A four-byte icon would otherwise grow, since the lh5 tables cost more than the data.
  const stored = compressed.length >= entry.bytes.length;
  const payload = stored ? entry.bytes : compressed;
  const method = stored ? '-lh0-' : '-lh5-';

  // Built back to front: each extended header declares the size of the one after it, and
  // the base header's trailing field declares the size of the first.
  const extendedHeaders: Uint8Array[] = [];
  if (directory !== '') {
    const components = encodeName(directory.split('/').join('\xff') + '\xff');
    extendedHeaders.push(extendedHeader(EXT_DIRECTORY, components, 0));
  }
  const extendedBytes = extendedHeaders.reduce((total, header) => total + header.length, 0);

  const nameBytes = encodeName(name);
  const baseLength = NAME_OFFSET + nameBytes.length + 5;
  const base = new Uint8Array(baseLength);
  const view = new DataView(base.buffer);

  base[0] = baseLength - 2;
  // base[1] is the checksum, filled in once the rest of the header is written.
  for (let i = 0; i < 5; i++) base[2 + i] = method.charCodeAt(i);
  // Level 1 reuses level 0's "compressed size" field as a skip distance, so it counts the
  // extended headers too; a reader subtracts each one as it consumes it.
  view.setUint32(7, payload.length + extendedBytes, true);
  view.setUint32(11, entry.bytes.length, true);
  view.setUint32(15, msdosTimestamp(modified), true);
  base[19] = ATTRIBUTE;
  base[20] = HEADER_LEVEL;
  base[21] = nameBytes.length;
  base.set(nameBytes, NAME_OFFSET);
  // The CRC is of the original bytes, never the compressed ones: `lha t` checks it after
  // decompressing, so a CRC over the payload would fail on every -lh5- entry.
  view.setUint16(NAME_OFFSET + nameBytes.length, crc16(entry.bytes), true);
  base[NAME_OFFSET + nameBytes.length + 2] = OS_AMIGA;
  view.setUint16(NAME_OFFSET + nameBytes.length + 3, extendedHeaders[0]?.length ?? 0, true);

  let checksum = 0;
  for (let i = 2; i < base.length; i++) checksum += base[i];
  base[1] = checksum & 0xff;

  const total = base.length + extendedBytes + payload.length;
  const out = new Uint8Array(total);
  let at = 0;
  out.set(base, at);
  at += base.length;
  for (const header of extendedHeaders) {
    out.set(header, at);
    at += header.length;
  }
  out.set(payload, at);
  return out;
}

export function buildLhaArchive(entries: LhaEntry[], modified: Date = new Date()): Uint8Array {
  const parts = entries.map((entry) => buildEntry(entry, modified));
  // A single zero byte where the next header's length would be: that is end-of-archive.
  const total = parts.reduce((sum, part) => sum + part.length, 0) + 1;

  const archive = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    archive.set(part, at);
    at += part.length;
  }
  archive[at] = 0;
  return archive;
}

import JSZip from 'jszip';
import { XzReadableStream } from 'xz-decompress';
import { untarStream } from './untar';

const ZIP_MAGIC = [0x50, 0x4b]; // "PK"
const GZIP_MAGIC = [0x1f, 0x8b];
const XZ_MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]; // "\xfd7zXZ\0"

function hasMagic(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, i) => bytes[i] === byte);
}

// Only files this tool can actually use are kept when expanding a tarball into
// a JSZip: icon themes are huge (Papirus is ~100MB uncompressed with tens of
// thousands of files), and parseTheme() ignores everything but .svg/.png/
// index.theme anyway, so holding licences, scripts and source files in memory
// buys nothing and risks exhausting the tab.
function isWanted(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  return /\.(svg|png)$/i.test(base) || base.toLowerCase() === 'index.theme';
}

export type ArchiveSource = ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>;

const SNIFF_BYTES = 6; // longest magic we test (xz)

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function toStream(source: ArchiveSource): ReadableStream<Uint8Array> {
  if (source instanceof ReadableStream) return source;
  return streamOf(source instanceof Uint8Array ? source : new Uint8Array(source));
}

/** Re-attaches already-read bytes to the front of a stream. */
function prepend(head: Uint8Array, rest: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = rest.getReader();
  return new ReadableStream({
    start(controller) {
      if (head.byteLength > 0) controller.enqueue(head);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** Reads at least `n` bytes (fewer only at end of stream) without losing them. */
async function peek(
  stream: ReadableStream<Uint8Array>,
  n: number,
): Promise<{ head: Uint8Array; rest: ReadableStream<Uint8Array> }> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  while (total < n) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.byteLength;
  }
  const head = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    head.set(part, offset);
    offset += part.byteLength;
  }
  reader.releaseLock();
  return { head, rest: prepend(head, stream) };
}

/**
 * Sniffs the archive format from its magic bytes and returns its contents as a JSZip.
 *
 * Tar archives are streamed: entries are filtered as they go past and only wanted files
 * are retained, so a 642MB theme never exists in memory at once. Zip archives are still
 * buffered because JSZip requires random access to the central directory.
 */
export async function loadArchive(source: ArchiveSource): Promise<JSZip> {
  const { head, rest } = await peek(toStream(source), SNIFF_BYTES);

  if (hasMagic(head, ZIP_MAGIC)) {
    return JSZip.loadAsync(await new Response(rest).arrayBuffer());
  }

  let tarStream: ReadableStream<Uint8Array>;
  if (hasMagic(head, GZIP_MAGIC)) {
    // Cast needed because lib.dom's DecompressionStream types its writable side as
    // BufferSource rather than Uint8Array, which TS's stricter Uint8Array<ArrayBuffer>
    // generic (added alongside the Streams types) doesn't structurally match at the
    // type level even though it's fine at runtime.
    tarStream = (rest as ReadableStream<Uint8Array<ArrayBuffer>>).pipeThrough(
      new DecompressionStream('gzip'),
    );
  } else if (hasMagic(head, XZ_MAGIC)) {
    tarStream = new XzReadableStream(rest);
  } else {
    await rest.cancel().catch(() => undefined);
    throw new Error(
      'Unrecognised archive format: expected a zip (PK), gzip (\\x1f\\x8b) or xz (\\xfd7zXZ) file.',
    );
  }

  const zip = new JSZip();
  for await (const entry of untarStream(tarStream)) {
    if (isWanted(entry.path)) zip.file(entry.path, entry.data);
  }
  return zip;
}

import JSZip from 'jszip';
import { untar } from './untar';

const ZIP_MAGIC = [0x50, 0x4b]; // "PK"
const GZIP_MAGIC = [0x1f, 0x8b];

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function hasMagic(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, i) => bytes[i] === byte);
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  // Built from a ReadableStream directly (rather than Blob#stream()) so this
  // works in every environment that implements the stream/compression
  // primitives themselves, without also depending on Blob's stream() method.
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }).pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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

/** Sniffs the archive format from its magic bytes and returns its contents as a JSZip. */
export async function loadArchive(data: ArrayBuffer | Uint8Array): Promise<JSZip> {
  const bytes = toUint8Array(data);

  if (hasMagic(bytes, ZIP_MAGIC)) {
    return JSZip.loadAsync(bytes);
  }

  if (hasMagic(bytes, GZIP_MAGIC)) {
    const tarBytes = await gunzip(bytes);
    const entries = untar(tarBytes);
    const zip = new JSZip();
    for (const entry of entries) {
      if (isWanted(entry.path)) {
        zip.file(entry.path, entry.data);
      }
    }
    return zip;
  }

  throw new Error('Unrecognised archive format: expected a zip (PK) or gzip (\\x1f\\x8b) file.');
}

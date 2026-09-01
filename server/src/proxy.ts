import { once } from 'node:events';
import type { RequestHandler } from 'express';

/**
 * Themes from store.kde.org run large: the "Uniform+ mini" archive is ~110MB compressed
 * (642MB and 272k files expanded), so a 100MB cap rejected exactly the downloads this
 * proxy exists to serve. The body is streamed rather than buffered (see below), so raising
 * this ceiling costs a bounded chunk of memory, not a proportional one.
 */
export const MAX_PROXY_BYTES = 512 * 1024 * 1024;

/**
 * How long the upstream gets to produce response *headers*.
 *
 * Deliberately not a whole-request budget. It used to be one — a single
 * `AbortSignal.timeout(30_000)` handed to `fetch` — and in undici that signal aborts the
 * response body stream as well as the connect/headers phase. A ~110MB `.tar.xz` needs
 * ~30 Mbps to land inside 30s and the 512MB cap needs ~137 Mbps, so on any ordinary link
 * the read rejected mid-body, the socket was destroyed, and the client blamed the archive
 * format ("could not be read as a zip, tar.gz or tar.xz archive") for what was a timeout.
 * The cap and the timeout have to express the same budget, and a size cap says nothing
 * about how long the transfer may take.
 */
export const HEADERS_TIMEOUT_MS = 30_000;

/**
 * How long the body may go without delivering a single chunk before we give up.
 *
 * This is the honest expression of "the upstream has stopped": it resets on every
 * successful read, so a slow-but-progressing download of any size is fine, while a
 * genuinely dead connection is still cut rather than pinning a socket forever.
 */
export const BODY_IDLE_TIMEOUT_MS = 60_000;

/**
 * One read, bounded by the idle timeout. The timer is created per read, so it restarts on
 * every chunk that actually arrives: a long download is not a stalled one.
 *
 * If the timeout wins, the losing `read()` is simply abandoned — the caller cancels the
 * reader and destroys the socket, so nothing is left waiting on it.
 */
async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_resolve, reject) => {
    idleTimer = setTimeout(
      () => reject(new Error(`Upstream sent no data for ${idleTimeoutMs}ms`)),
      idleTimeoutMs,
    );
  });
  try {
    return await Promise.race([reader.read(), stalled]);
  } finally {
    clearTimeout(idleTimer);
  }
}

export function createFetchProxyHandler(
  options: { maxBytes?: number; headersTimeoutMs?: number; idleTimeoutMs?: number } = {},
): RequestHandler {
  const maxBytes = options.maxBytes ?? MAX_PROXY_BYTES;
  const headersTimeoutMs = options.headersTimeoutMs ?? HEADERS_TIMEOUT_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? BODY_IDLE_TIMEOUT_MS;

  return async (req, res) => {
    const rawUrl = req.query.url;
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
      res.status(400).json({ error: 'Missing required "url" query parameter' });
      return;
    }

    let target: URL;
    try {
      target = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      res.status(400).json({ error: 'Only http(s) URLs are allowed' });
      return;
    }

    // Its own controller, cleared the moment the response resolves, so the signal is
    // never live while the body is being read.
    const headersController = new AbortController();
    const headersTimer = setTimeout(() => headersController.abort(), headersTimeoutMs);
    let upstream: Response;
    try {
      upstream = await fetch(target.toString(), { signal: headersController.signal });
    } catch {
      res.status(502).json({ error: 'Failed to fetch the requested URL' });
      return;
    } finally {
      clearTimeout(headersTimer);
    }

    if (!upstream.ok) {
      res.status(502).json({ error: `Upstream responded with status ${upstream.status}` });
      return;
    }

    const contentLength = Number(upstream.headers.get('content-length') ?? '0');
    if (contentLength > maxBytes) {
      res.status(413).json({ error: `Response exceeds the ${maxBytes}-byte size cap` });
      return;
    }

    const reader = upstream.body?.getReader();
    if (!reader) {
      res.status(502).json({ error: 'Upstream response had no readable body' });
      return;
    }

    // Never reflect the upstream content-type: an attacker-controlled response could
    // set text/html and get script served from this app's own origin. The client only
    // ever reads this body as an archive blob, so a fixed generic type is safe.
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-disposition', 'attachment');
    res.status(200);

    let received = 0;
    try {
      for (;;) {
        const { done, value } = await readWithIdleTimeout(reader, idleTimeoutMs);
        if (done) break;

        received += value.byteLength;
        if (received > maxBytes) {
          // The 200 headers are already on the wire, so a 413 is no longer expressible.
          // Cancel upstream and drop the connection; the client sees a failed download.
          // Servers that send content-length are rejected cleanly by the check above.
          await reader.cancel();
          res.destroy();
          return;
        }

        // Respect backpressure. Without this, Node queues the whole body in the socket's
        // write buffer and streaming saves nothing over the Buffer.concat it replaced.
        if (!res.write(value)) await once(res, 'drain');
      }
    } catch {
      await reader.cancel().catch(() => {});
      res.destroy();
      return;
    }

    res.end();
  };
}

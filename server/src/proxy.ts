import { once } from 'node:events';
import type { RequestHandler } from 'express';

/**
 * Themes from store.kde.org run large: the "Uniform+ mini" archive is ~110MB compressed
 * (642MB and 272k files expanded), so a 100MB cap rejected exactly the downloads this
 * proxy exists to serve. The body is streamed rather than buffered (see below), so raising
 * this ceiling costs a bounded chunk of memory, not a proportional one.
 */
export const MAX_PROXY_BYTES = 512 * 1024 * 1024;

export function createFetchProxyHandler(options: { maxBytes?: number } = {}): RequestHandler {
  const maxBytes = options.maxBytes ?? MAX_PROXY_BYTES;

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

    let upstream: Response;
    try {
      upstream = await fetch(target.toString(), { signal: AbortSignal.timeout(30_000) });
    } catch {
      res.status(502).json({ error: 'Failed to fetch the requested URL' });
      return;
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
        const { done, value } = await reader.read();
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

import type { RequestHandler } from 'express';

export const MAX_PROXY_BYTES = 25 * 1024 * 1024;

export function createFetchProxyHandler(): RequestHandler {
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
    if (contentLength > MAX_PROXY_BYTES) {
      res.status(413).json({ error: `Response exceeds the ${MAX_PROXY_BYTES}-byte size cap` });
      return;
    }

    const reader = upstream.body?.getReader();
    if (!reader) {
      res.status(502).json({ error: 'Upstream response had no readable body' });
      return;
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_PROXY_BYTES) {
        await reader.cancel();
        res.status(413).json({ error: `Response exceeds the ${MAX_PROXY_BYTES}-byte size cap` });
        return;
      }
      chunks.push(value);
    }

    // Never reflect the upstream content-type: an attacker-controlled response could
    // set text/html and get script served from this app's own origin. The client only
    // ever reads this body as a zip blob, so a fixed generic type is safe.
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-disposition', 'attachment');
    res.status(200).send(Buffer.concat(chunks));
  };
}

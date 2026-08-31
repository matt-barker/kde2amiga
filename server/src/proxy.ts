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
      upstream = await fetch(target.toString());
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

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength > MAX_PROXY_BYTES) {
      res.status(413).json({ error: `Response exceeds the ${MAX_PROXY_BYTES}-byte size cap` });
      return;
    }

    res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/octet-stream');
    res.status(200).send(buffer);
  };
}

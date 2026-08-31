import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFetchProxyHandler } from './proxy';

afterEach(() => {
  vi.restoreAllMocks();
});

function appWithProxy() {
  const app = express();
  app.get('/api/fetch-url', createFetchProxyHandler());
  return app;
}

describe('createFetchProxyHandler', () => {
  it('rejects requests missing the url parameter', async () => {
    const res = await request(appWithProxy()).get('/api/fetch-url');
    expect(res.status).toBe(400);
  });

  it('rejects non-http(s) URLs', async () => {
    const res = await request(appWithProxy()).get('/api/fetch-url?url=file:///etc/passwd');
    expect(res.status).toBe(400);
  });

  it('proxies a successful upstream response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/zip', 'content-length': '3' }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }),
    );

    const res = await request(appWithProxy()).get(
      '/api/fetch-url?url=' + encodeURIComponent('https://example.com/theme.zip'),
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
  });

  it('returns 413 when the upstream content-length exceeds the size cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/zip', 'content-length': String(100 * 1024 * 1024) }),
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    );

    const res = await request(appWithProxy()).get(
      '/api/fetch-url?url=' + encodeURIComponent('https://example.com/huge.zip'),
    );
    expect(res.status).toBe(413);
  });

  it('returns 502 when the upstream fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const res = await request(appWithProxy()).get(
      '/api/fetch-url?url=' + encodeURIComponent('https://example.com/theme.zip'),
    );
    expect(res.status).toBe(502);
  });
});

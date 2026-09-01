import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFetchProxyHandler } from './proxy.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function appWithProxy(options?: { maxBytes?: number }) {
  const app = express();
  app.get('/api/fetch-url', createFetchProxyHandler(options));
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
        body: streamOf(new Uint8Array([1, 2, 3])),
      }),
    );

    const res = await request(appWithProxy()).get(
      '/api/fetch-url?url=' + encodeURIComponent('https://example.com/theme.zip'),
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBe('attachment');
  });

  it('never reflects an upstream content-type, even text/html', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html', 'content-length': '3' }),
        body: streamOf(new Uint8Array([1, 2, 3])),
      }),
    );

    const res = await request(appWithProxy()).get(
      '/api/fetch-url?url=' + encodeURIComponent('https://example.com/evil.html'),
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-type']).not.toMatch(/html/);
  });

  it('returns 413 when the upstream content-length exceeds the size cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/zip', 'content-length': String(101 * 1024 * 1024) }),
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    );

    const res = await request(appWithProxy({ maxBytes: 1024 })).get(
      '/api/fetch-url?url=' + encodeURIComponent('https://example.com/huge.zip'),
    );
    expect(res.status).toBe(413);
  });

  // The body is streamed straight through to the client rather than buffered, so by the
  // time an over-cap chunked response is detected the 200 headers have already gone out
  // and a 413 is no longer expressible. The connection is destroyed instead, which is what
  // the client sees as a failed download. Well-behaved servers send content-length and get
  // the clean 413 above; this path is the safety net for chunked responses.
  it('aborts the connection when a chunked body exceeds the cap', async () => {
    const chunk = new Uint8Array(1024);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/zip' }), // deliberately no content-length
        body: streamOf(...Array(8).fill(chunk)),
      }),
    );

    await expect(
      request(appWithProxy({ maxBytes: 4 * 1024 })).get(
        '/api/fetch-url?url=' + encodeURIComponent('https://example.com/huge.zip'),
      ),
    ).rejects.toThrow();
  });

  it('streams a body larger than the old 100MB cap when under the configured cap', async () => {
    const oneMegabyte = new Uint8Array(1024 * 1024);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/zip' }),
        body: streamOf(...Array(120).fill(oneMegabyte)),
      }),
    );

    const res = await request(appWithProxy()).get(
      '/api/fetch-url?url=' + encodeURIComponent('https://example.com/uniform.tar.xz'),
    );
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(120 * 1024 * 1024);
  });

  it('returns 502 when the upstream fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const res = await request(appWithProxy()).get(
      '/api/fetch-url?url=' + encodeURIComponent('https://example.com/theme.zip'),
    );
    expect(res.status).toBe(502);
  });
});

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

function appWithProxy(options?: { maxBytes?: number; headersTimeoutMs?: number; idleTimeoutMs?: number }) {
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

  // The 30s budget used to be a single AbortSignal.timeout() passed to fetch(). In undici
  // that signal aborts the *response body stream* too, not just connect/headers — so the
  // very downloads the raised size cap exists to allow (a ~110MB .tar.xz needs ~30 Mbps to
  // land inside 30s) were killed mid-body, and the client reported the generic "could not
  // be read as an archive" message for what was really a timeout.
  it('keeps streaming a slow body long past the headers budget, as long as it makes progress', async () => {
    const chunk = new Uint8Array(1024);
    let sent = 0;

    // The stub deliberately models undici's behaviour rather than ignoring the signal:
    // aborting the fetch signal errors the response body stream, mid-download. A stub that
    // ignored the signal would pass this test whether the timeout covered the whole request
    // or only the headers, which would make it worthless as a regression guard.
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: { signal: AbortSignal }) =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/zip' }),
          body: new ReadableStream<Uint8Array>({
            async pull(controller) {
              await new Promise((resolve) => setTimeout(resolve, 30));
              if (init.signal.aborted) {
                controller.error(new Error('This operation was aborted'));
                return;
              }
              if (sent >= 10) {
                controller.close();
                return;
              }
              sent++;
              controller.enqueue(chunk);
            },
          }),
        }),
      ),
    );

    // The whole body takes ~300ms, five times the headers budget.
    const res = await request(appWithProxy({ headersTimeoutMs: 60, idleTimeoutMs: 400 })).get(
      '/api/fetch-url?url=' + encodeURIComponent('https://example.com/slow.tar.xz'),
    );

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(10 * 1024);
  });

  it('gives up when the upstream never sends response headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      ),
    );

    const res = await request(appWithProxy({ headersTimeoutMs: 50 })).get(
      '/api/fetch-url?url=' + encodeURIComponent('https://example.com/blackhole.zip'),
    );

    expect(res.status).toBe(502);
  });

  it('drops the connection when the upstream body stalls mid-stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/zip' }),
        // One chunk, then silence forever: the stream is never closed and never errors.
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(16));
          },
        }),
      }),
    );

    await expect(
      request(appWithProxy({ headersTimeoutMs: 1000, idleTimeoutMs: 50 })).get(
        '/api/fetch-url?url=' + encodeURIComponent('https://example.com/stalled.zip'),
      ),
    ).rejects.toThrow();
  });
});

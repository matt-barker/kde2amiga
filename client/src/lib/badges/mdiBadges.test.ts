import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchMdiBadgeSvg } from './mdiBadges';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchMdiBadgeSvg', () => {
  it('fetches directly from the jsdelivr CDN when it succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '<svg>music</svg>' });
    vi.stubGlobal('fetch', fetchMock);

    const svg = await fetchMdiBadgeSvg('music-note');
    expect(svg).toBe('<svg>music</svg>');
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.jsdelivr.net/npm/@mdi/svg/svg/music-note.svg');
  });

  it('falls back to the proxy when the direct fetch fails and a proxy URL is given', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({ ok: true, text: async () => '<svg>via-proxy</svg>' });
    vi.stubGlobal('fetch', fetchMock);

    const svg = await fetchMdiBadgeSvg('music-note', '/api/fetch-url');
    expect(svg).toBe('<svg>via-proxy</svg>');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/fetch-url?url=' + encodeURIComponent('https://cdn.jsdelivr.net/npm/@mdi/svg/svg/music-note.svg'),
    );
  });

  it('throws a descriptive error when both direct and proxy fetches fail', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMdiBadgeSvg('not-a-real-icon', '/api/fetch-url')).rejects.toThrow(
      /not-a-real-icon/,
    );
  });

  it('throws a descriptive error when the proxy fetch itself throws', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMdiBadgeSvg('music-note', '/api/fetch-url')).rejects.toThrow(/music-note/);
  });

  it('rejects an icon name that would escape the CDN path, without ever calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMdiBadgeSvg('../../etc/passwd')).rejects.toThrow(/Invalid MDI icon name/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

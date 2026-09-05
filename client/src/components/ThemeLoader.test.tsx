import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { ThemeLoader } from './ThemeLoader';

async function makeThemeZipFile(): Promise<File> {
  const zip = new JSZip();
  zip.file('scalable/places/folder.svg', '<svg></svg>');
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'theme.zip', { type: 'application/zip' });
}

const TAR_BLOCK = 512;

function tarOctal(value: number, length: number): Uint8Array {
  const str = value.toString(8).padStart(length - 1, '0') + '\0';
  return new TextEncoder().encode(str);
}

function tarWriteField(header: Uint8Array, offset: number, value: string | Uint8Array, length: number) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const out = new Uint8Array(length);
  out.set(bytes.subarray(0, length));
  header.set(out, offset);
}

function tarHeader(name: string, size: number): Uint8Array {
  const header = new Uint8Array(TAR_BLOCK);
  tarWriteField(header, 0, name, 100);
  tarWriteField(header, 124, tarOctal(size, 12), 12);
  tarWriteField(header, 156, '0', 1);
  tarWriteField(header, 257, 'ustar\0', 6);
  header.set(new TextEncoder().encode('        '), 148);
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) sum += header[i];
  tarWriteField(header, 148, sum.toString(8).padStart(6, '0') + '\0 ', 8);
  return header;
}

function tarPad(data: Uint8Array): Uint8Array {
  const rem = data.length % TAR_BLOCK;
  if (rem === 0) return data;
  const out = new Uint8Array(data.length + (TAR_BLOCK - rem));
  out.set(data);
  return out;
}

function tarConcat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function tarFileEntry(name: string, contents: string): Uint8Array {
  const data = new TextEncoder().encode(contents);
  return tarConcat([tarHeader(name, data.length), tarPad(data)]);
}

function makeThemeTarGzFile(): File {
  const tar = tarConcat([
    tarFileEntry('theme/scalable/places/folder.svg', '<svg></svg>'),
    new Uint8Array(TAR_BLOCK * 2),
  ]);
  const gz = new Uint8Array(gzipSync(Buffer.from(tar)));
  return new File([gz], 'theme.tar.gz', { type: 'application/gzip' });
}

const moduleUrl = import.meta.url;

/**
 * The same .tar.xz fixture archive.test.ts decodes directly. Built by `tar -cJf`, so the
 * xz container, filters and block layout are a real encoder's, not a hand-rolled one's.
 */
function makeThemeTarXzFile(): File {
  // Held in a variable rather than written inline: Vite rewrites a literal
  // `new URL(..., import.meta.url)` into an asset URL, which is not a file: URL and so
  // cannot be handed to fileURLToPath. archive.test.ts sidesteps it the same way.
  const path = fileURLToPath(new URL('../lib/theme/__fixtures__/sample-theme.tar.xz', moduleUrl));
  return new File([readFileSync(path)], 'theme.tar.xz', { type: 'application/x-xz' });
}

describe('ThemeLoader', () => {
  it('parses an uploaded zip and reports the discovered icons', async () => {
    const onThemeLoaded = vi.fn();
    render(<ThemeLoader onThemeLoaded={onThemeLoaded} />);

    const file = await makeThemeZipFile();
    const input = screen.getByLabelText(/upload/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onThemeLoaded).toHaveBeenCalledTimes(1));
    const [, icons] = onThemeLoaded.mock.calls[0];
    expect(icons).toHaveLength(1);
    expect(icons[0].name).toBe('folder');
  });

  it('shows an inline error when the uploaded file is not a valid zip', async () => {
    const onThemeLoaded = vi.fn();
    render(<ThemeLoader onThemeLoaded={onThemeLoaded} />);

    const badFile = new File(['not a zip'], 'theme.zip', { type: 'application/zip' });
    const input = screen.getByLabelText(/upload/i);
    fireEvent.change(input, { target: { files: [badFile] } });

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onThemeLoaded).not.toHaveBeenCalled();
  });

  it('parses an uploaded tar.gz and reports the discovered icons', async () => {
    const onThemeLoaded = vi.fn();
    render(<ThemeLoader onThemeLoaded={onThemeLoaded} />);

    const file = makeThemeTarGzFile();
    const input = screen.getByLabelText(/upload/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onThemeLoaded).toHaveBeenCalledTimes(1));
    const [, icons] = onThemeLoaded.mock.calls[0];
    expect(icons).toHaveLength(1);
    expect(icons[0].name).toBe('folder');
  });

  // The .tar.xz path had only ever been exercised by calling loadArchive() with a whole
  // Uint8Array; nothing covered it through the component's actual upload path. Note that
  // the jsdom Blob.stream() polyfill (see test/installBlobStream.ts) emits the file as a
  // single chunk, so this proves the wiring — file input -> Blob.stream() -> xz decode ->
  // untar -> parseTheme — rather than proving incremental chunk handling.
  it('parses an uploaded tar.xz and reports the discovered icons', async () => {
    const onThemeLoaded = vi.fn();
    render(<ThemeLoader onThemeLoaded={onThemeLoaded} />);

    const file = makeThemeTarXzFile();
    const input = screen.getByLabelText(/upload/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onThemeLoaded).toHaveBeenCalledTimes(1));
    const [, icons] = onThemeLoaded.mock.calls[0];
    expect(icons).toHaveLength(1);
    expect(icons[0].name).toBe('sample');
  });

  it('fetches a theme from a URL and reports the discovered icons', async () => {
    const zip = new JSZip();
    zip.file('scalable/places/folder.svg', '<svg></svg>');
    const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' });

    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(arrayBuffer));
        c.close();
      },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body,
    } as Response);

    const onThemeLoaded = vi.fn();
    render(<ThemeLoader onThemeLoaded={onThemeLoaded} />);

    fireEvent.change(screen.getByLabelText(/direct archive url/i), { target: { value: 'https://example.com/theme.zip' } });
    fireEvent.click(screen.getByRole('button', { name: /fetch archive url/i }));

    await waitFor(() => expect(onThemeLoaded).toHaveBeenCalledTimes(1));
    const [, icons] = onThemeLoaded.mock.calls[0];
    expect(icons).toHaveLength(1);
    expect(icons[0].name).toBe('folder');

    fetchSpy.mockRestore();
  });

  it('shows an inline error when the URL fetch responds with a non-2xx status', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 404 }),
    );

    const onThemeLoaded = vi.fn();
    render(<ThemeLoader onThemeLoaded={onThemeLoaded} />);

    fireEvent.change(screen.getByLabelText(/direct archive url/i), { target: { value: 'https://example.com/theme.zip' } });
    fireEvent.click(screen.getByRole('button', { name: /fetch archive url/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toMatch(/404/);
    expect(onThemeLoaded).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});

/*
 * Unpacking a theme is slow — hundreds of thousands of entries for a full KDE set — and
 * until it lands the page looks like nothing happened. The overlay says otherwise, and
 * has to be up *while* the work runs rather than after it.
 */
describe('while a theme is being read', () => {
  it('shows a status overlay as soon as a file is chosen', async () => {
    const onThemeLoaded = vi.fn();
    render(<ThemeLoader onThemeLoaded={onThemeLoaded} />);

    const file = await makeThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });

    expect(screen.getByRole('status')).toHaveTextContent(/reading theme/i);
    await waitFor(() => expect(onThemeLoaded).toHaveBeenCalledTimes(1));
  });

  it('takes the overlay down once the theme has loaded', async () => {
    const onThemeLoaded = vi.fn();
    render(<ThemeLoader onThemeLoaded={onThemeLoaded} />);

    const file = await makeThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });

    await waitFor(() => expect(onThemeLoaded).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('takes the overlay down when the archive turns out to be unreadable', async () => {
    // The failure path is exactly where a stuck overlay would trap the user: the error
    // is right there behind it, and nothing more is coming.
    render(<ThemeLoader onThemeLoaded={vi.fn()} />);

    const badFile = new File(['not a zip'], 'theme.zip', { type: 'application/zip' });
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [badFile] } });

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the overlay for a URL fetch too', async () => {
    const zip = new JSZip();
    zip.file('scalable/places/folder.svg', '<svg></svg>');
    const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(arrayBuffer));
          c.close();
        },
      }),
    } as Response);

    const onThemeLoaded = vi.fn();
    render(<ThemeLoader onThemeLoaded={onThemeLoaded} />);

    fireEvent.change(screen.getByLabelText(/direct archive url/i), { target: { value: 'https://example.com/theme.zip' } });
    fireEvent.click(screen.getByRole('button', { name: /fetch archive url/i }));

    expect(screen.getByRole('status')).toHaveTextContent(/reading theme/i);
    await waitFor(() => expect(onThemeLoaded).toHaveBeenCalledTimes(1));

    fetchSpy.mockRestore();
  });
});

/*
 * A store.kde.org product page never shows a download link: the archive URL is a
 * short-lived signed token behind the OCS API. These cover the two hops that turn a
 * pasted page URL into an unpacked theme, and the fork between them.
 */
describe('fetching from a store.kde.org URL', () => {
  async function themeZipBytes(): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file('scalable/places/folder.svg', '<svg></svg>');
    return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer' }));
  }

  function ocsEnvelope(content: Record<string, unknown>) {
    return { status: 'ok', statuscode: 100, message: '', data: [content] };
  }

  /**
   * Routes by target rather than by call order, so a test asserts on which URL was
   * fetched instead of on how many times fetch happened to be called.
   */
  function mockProxy(ocsPayload: unknown, archive: Uint8Array) {
    const seen: string[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const requested = decodeURIComponent(String(input));
      seen.push(requested);
      if (requested.includes('api.kde-look.org')) {
        return { ok: true, status: 200, json: async () => ocsPayload } as Response;
      }
      return {
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(archive);
            c.close();
          },
        }),
      } as Response;
    });
    return { spy, seen };
  }

  function pasteStoreUrl(url: string) {
    fireEvent.change(screen.getByLabelText(/store\.kde\.org url/i), { target: { value: url } });
    fireEvent.click(screen.getByRole('button', { name: /fetch store product/i }));
  }

  it('unpacks the archive straight away when the product has a single file', async () => {
    const { spy, seen } = mockProxy(
      ocsEnvelope({
        name: 'Slot-Silvery-Dark-Icons',
        downloadlink1: 'https://files06.pling.com/signed/Slot.tar.xz',
        downloadname1: 'Slot-Silvery-Dark-Icons.tar.xz',
        downloadsize1: '20224',
      }),
      await themeZipBytes(),
    );

    const onThemeLoaded = vi.fn();
    render(<ThemeLoader onThemeLoaded={onThemeLoaded} />);
    pasteStoreUrl('https://store.kde.org/p/2344960');

    await waitFor(() => expect(onThemeLoaded).toHaveBeenCalledTimes(1));
    const [, icons] = onThemeLoaded.mock.calls[0];
    expect(icons[0].name).toBe('folder');
    // The signed link must be fetched through the app's own proxy, never straight from
    // the browser: api.kde-look.org sends no CORS headers, and the token is minted for
    // whichever address asked for it.
    expect(seen.some((u) => u.startsWith('/api/fetch-url?url=https://files06.pling.com/signed/'))).toBe(true);

    spy.mockRestore();
  });

  it('names each download with its size, so two variants can be told apart before a fetch', async () => {
    // The size is the only thing distinguishing a 4 MB theme from a 40 MB one before
    // committing to the download, so it belongs in the option text rather than beside it:
    // a select collapses to the chosen option, and anything outside it is not shown.
    const { spy } = mockProxy(
      ocsEnvelope({
        name: 'Arcanum Icon theme',
        downloadlink1: 'https://files.example/Blue.tar.xz',
        downloadname1: 'Arcanum-Blue.tar.xz',
        downloadsize1: '4200',
        downloadlink2: 'https://files.example/Green.tar.xz',
        downloadname2: 'Arcanum-Green.tar.xz',
        downloadsize2: '512',
      }),
      await themeZipBytes(),
    );

    render(<ThemeLoader onThemeLoaded={vi.fn()} />);
    pasteStoreUrl('https://store.kde.org/p/2359362');

    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Arcanum-Blue\.tar\.xz.*4\.1 MB/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole('option', { name: /Arcanum-Green\.tar\.xz.*512 KB/ })).toBeInTheDocument();

    spy.mockRestore();
  });

  it('offers the variants when the product has several files, and loads the chosen one', async () => {
    const { spy, seen } = mockProxy(
      ocsEnvelope({
        name: 'Arcanum Icon theme',
        downloadlink1: 'https://files.example/Blue.tar.xz',
        downloadname1: 'Arcanum-Blue.tar.xz',
        downloadsize1: '4200',
        downloadlink2: 'https://files.example/Green.tar.xz',
        downloadname2: 'Arcanum-Green.tar.xz',
        downloadsize2: '4210',
      }),
      await themeZipBytes(),
    );

    const onThemeLoaded = vi.fn();
    render(<ThemeLoader onThemeLoaded={onThemeLoaded} />);
    pasteStoreUrl('https://store.kde.org/p/2359362');

    // Nothing is unpacked until a variant is picked — Blue and Green are different themes.
    const picker = await screen.findByLabelText(/which download/i);
    expect(within(picker).getAllByRole('option')).toHaveLength(2);
    expect(onThemeLoaded).not.toHaveBeenCalled();

    fireEvent.change(picker, { target: { value: 'https://files.example/Green.tar.xz' } });
    fireEvent.click(screen.getByRole('button', { name: /load selected/i }));

    await waitFor(() => expect(onThemeLoaded).toHaveBeenCalledTimes(1));
    expect(seen.some((u) => u.includes('files.example/Green.tar.xz'))).toBe(true);
    expect(seen.some((u) => u.includes('files.example/Blue.tar.xz'))).toBe(false);

    spy.mockRestore();
  });

  it('names the product alongside the variants so the right page is obviously loaded', async () => {
    const { spy } = mockProxy(
      ocsEnvelope({
        name: 'Arcanum Icon theme',
        downloadlink1: 'https://files.example/Blue.tar.xz',
        downloadname1: 'Arcanum-Blue.tar.xz',
        downloadsize1: '4200',
        downloadlink2: 'https://files.example/Green.tar.xz',
        downloadname2: 'Arcanum-Green.tar.xz',
        downloadsize2: '4210',
      }),
      await themeZipBytes(),
    );

    render(<ThemeLoader onThemeLoaded={vi.fn()} />);
    pasteStoreUrl('https://store.kde.org/p/2359362');

    await waitFor(() => expect(screen.getByText(/Arcanum Icon theme/)).toBeInTheDocument());

    spy.mockRestore();
  });

  it('rejects a pasted URL that is not a store product page without going to the network', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');

    render(<ThemeLoader onThemeLoaded={vi.fn()} />);
    pasteStoreUrl('https://example.com/theme.tar.xz');

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toMatch(/store\.kde\.org/i);
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('reports an unknown product id, which the API answers with 200 and statuscode 999', async () => {
    const { spy } = mockProxy(
      { status: 'failed', statuscode: 999, message: 'unknown request' },
      await themeZipBytes(),
    );

    render(<ThemeLoader onThemeLoaded={vi.fn()} />);
    pasteStoreUrl('https://store.kde.org/p/999999999');

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toMatch(/no product/i);

    spy.mockRestore();
  });

  it('takes the overlay down once the variant list is on screen', async () => {
    // The picker is a stopping point, not a step on the way to unpacking: leaving the
    // blocking overlay up would hide the very list the user has to act on.
    const { spy } = mockProxy(
      ocsEnvelope({
        name: 'Arcanum Icon theme',
        downloadlink1: 'https://files.example/Blue.tar.xz',
        downloadname1: 'Arcanum-Blue.tar.xz',
        downloadsize1: '4200',
        downloadlink2: 'https://files.example/Green.tar.xz',
        downloadname2: 'Arcanum-Green.tar.xz',
        downloadsize2: '4210',
      }),
      await themeZipBytes(),
    );

    render(<ThemeLoader onThemeLoaded={vi.fn()} />);
    pasteStoreUrl('https://store.kde.org/p/2359362');

    await waitFor(() => expect(screen.getByRole('option', { name: /Arcanum-Blue/ })).toBeInTheDocument());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    spy.mockRestore();
  });
});

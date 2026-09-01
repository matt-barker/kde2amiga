import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { gzipSync } from 'node:zlib';
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

    fireEvent.change(screen.getByLabelText(/fetch from a url/i), { target: { value: 'https://example.com/theme.zip' } });
    fireEvent.click(screen.getByRole('button', { name: /fetch/i }));

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

    fireEvent.change(screen.getByLabelText(/fetch from a url/i), { target: { value: 'https://example.com/theme.zip' } });
    fireEvent.click(screen.getByRole('button', { name: /fetch/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toMatch(/404/);
    expect(onThemeLoaded).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});

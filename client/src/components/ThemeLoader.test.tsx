import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import { ThemeLoader } from './ThemeLoader';

async function makeThemeZipFile(): Promise<File> {
  const zip = new JSZip();
  zip.file('scalable/places/folder.svg', '<svg></svg>');
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'theme.zip', { type: 'application/zip' });
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

  it('fetches a theme from a URL and reports the discovered icons', async () => {
    const zip = new JSZip();
    zip.file('scalable/places/folder.svg', '<svg></svg>');
    const blob = await zip.generateAsync({ type: 'blob' });

    // Construct a minimal Response-shaped object rather than a real `Response`:
    // jsdom's `Blob` and undici's fetch `Blob` are different classes, and
    // JSZip.loadAsync rejects a cross-realm Blob it doesn't recognise.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => blob,
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

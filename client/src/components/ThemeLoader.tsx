import { useState, type ChangeEvent } from 'react';
import type JSZip from 'jszip';
import { loadArchive } from '../lib/theme/archive';
import { parseTheme, type ThemeIcon } from '../lib/theme/themeParser';

export function ThemeLoader(props: { onThemeLoaded: (zip: JSZip, icons: ThemeIcon[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');

  async function loadFromArchiveData(data: ArrayBuffer) {
    try {
      const zip = await loadArchive(data);
      const icons = await parseTheme(zip);
      if (icons.length === 0) {
        setError('No KDE-theme-shaped icons were found in this archive.');
        return;
      }
      setError(null);
      props.onThemeLoaded(zip, icons);
    } catch (err) {
      console.error('Failed to read theme archive:', err);
      setError('That file could not be read as a zip or tar.gz archive.');
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadFromArchiveData(await file.arrayBuffer());
  }

  async function handleFetchUrl() {
    if (!url) return;
    try {
      const response = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}`);
      if (!response.ok) {
        setError(`Could not fetch that URL (status ${response.status}).`);
        return;
      }
      await loadFromArchiveData(await response.arrayBuffer());
    } catch (err) {
      console.error('Failed to fetch theme URL:', err);
      setError('Could not fetch that URL.');
    }
  }

  return (
    <div>
      <label htmlFor="theme-upload">Upload a theme zip or tar.gz</label>
      <input id="theme-upload" type="file" accept=".zip,.tar.gz,.tgz" onChange={handleFileChange} />

      <label htmlFor="theme-url">Or fetch from a URL</label>
      <input id="theme-url" type="text" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button type="button" onClick={handleFetchUrl}>Fetch</button>

      {error && <p role="alert">{error}</p>}
    </div>
  );
}

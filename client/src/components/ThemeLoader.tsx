import { useState, type ChangeEvent } from 'react';
import JSZip from 'jszip';
import { parseTheme, type ThemeIcon } from '../lib/theme/themeParser';

export function ThemeLoader(props: { onThemeLoaded: (zip: JSZip, icons: ThemeIcon[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');

  async function loadFromZipData(data: ArrayBuffer | Blob) {
    try {
      const zip = await JSZip.loadAsync(data);
      const icons = await parseTheme(zip);
      if (icons.length === 0) {
        setError('No KDE-theme-shaped icons were found in this zip.');
        return;
      }
      setError(null);
      props.onThemeLoaded(zip, icons);
    } catch {
      setError('That file could not be read as a zip archive.');
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadFromZipData(await file.arrayBuffer());
  }

  async function handleFetchUrl() {
    if (!url) return;
    try {
      const response = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}`);
      if (!response.ok) {
        setError(`Could not fetch that URL (status ${response.status}).`);
        return;
      }
      await loadFromZipData(await response.blob());
    } catch {
      setError('Could not fetch that URL.');
    }
  }

  return (
    <div>
      <label htmlFor="theme-upload">Upload a theme zip</label>
      <input id="theme-upload" type="file" accept=".zip" onChange={handleFileChange} />

      <label htmlFor="theme-url">Or fetch from a URL</label>
      <input id="theme-url" type="text" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button type="button" onClick={handleFetchUrl}>Fetch</button>

      {error && <p role="alert">{error}</p>}
    </div>
  );
}

import { useState, type ChangeEvent } from 'react';
import type JSZip from 'jszip';
import { loadArchive, type ArchiveSource } from '../lib/theme/archive';
import { parseTheme, type IconGroup } from '../lib/theme/themeParser';
import './ThemeLoader.css';

/**
 * Hands the browser one macrotask in which to paint.
 *
 * Unpacking an archive is a long synchronous burst broken only by microtask awaits, and
 * the browser never paints between those — so an overlay switched on immediately before
 * it would not appear on screen until the work it was announcing had already finished.
 * A `setTimeout(0)` is a macrotask, which is what actually lets a frame through.
 */
function paintBeforeWorking(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function ThemeLoader(props: { onThemeLoaded: (zip: JSZip, groups: IconGroup[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadFromArchive(source: ArchiveSource) {
    try {
      const zip = await loadArchive(source);
      const groups = await parseTheme(zip);
      if (groups.length === 0) {
        setError('No KDE-theme-shaped icons were found in this archive.');
        return;
      }
      setError(null);
      props.onThemeLoaded(zip, groups);
    } catch (err) {
      console.error('Failed to read theme archive:', err);
      setError('That file could not be read as a zip, tar.gz or tar.xz archive.');
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await paintBeforeWorking();
      await loadFromArchive(file.stream());
    } finally {
      // In a finally, so a failed read cannot leave the overlay standing over the error
      // message it is hiding.
      setBusy(false);
    }
  }

  async function handleFetchUrl() {
    if (!url) return;
    setBusy(true);
    try {
      await paintBeforeWorking();
      const response = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}`);
      if (!response.ok) {
        setError(`Could not fetch that URL (status ${response.status}).`);
        return;
      }
      if (!response.body) {
        setError('That URL returned an empty response.');
        return;
      }
      await loadFromArchive(response.body);
    } catch (err) {
      console.error('Failed to fetch theme URL:', err);
      setError('Could not fetch that URL.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loader">
      <div className="loader__field">
        <label htmlFor="theme-upload">Upload a theme zip, tar.gz or tar.xz</label>
        <input
          id="theme-upload"
          type="file"
          accept=".zip,.tar.gz,.tgz,.tar.xz,.txz"
          disabled={busy}
          onChange={handleFileChange}
        />
      </div>

      <div className="loader__field">
        <label htmlFor="theme-url">Or fetch from a URL</label>
        <div className="loader__url">
          <input
            id="theme-url"
            type="text"
            placeholder="https://example.com/theme.tar.xz"
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="button" disabled={busy} onClick={handleFetchUrl}>Fetch</button>
        </div>
      </div>

      {error && <p className="loader__error" role="alert">{error}</p>}

      {busy && (
        /*
         * Modal rather than an inline line of text. A full theme takes tens of seconds to
         * unpack, during which every other control on the page would act on a selection
         * that is about to be replaced — so blocking is the honest state, not a courtesy.
         */
        <div className="loader__overlay">
          <div className="loader__card" role="status">
            <span className="loader__spinner" aria-hidden="true" />
            <strong>Reading theme…</strong>
            <span className="loader__hint">Unpacking the archive and finding icons.</span>
          </div>
        </div>
      )}
    </div>
  );
}

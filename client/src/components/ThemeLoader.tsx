import { useState, type ChangeEvent } from 'react';
import type JSZip from 'jszip';
import { loadArchive, type ArchiveSource } from '../lib/theme/archive';
import { parseTheme, type IconGroup } from '../lib/theme/themeParser';
import {
  parseStoreProductId,
  ocsProductUrl,
  parseStoreProduct,
  type StoreProduct,
} from '../lib/theme/storeUrl';
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

/**
 * Everything remote goes through the app's own proxy, and the store path needs it twice.
 *
 * The OCS API sends no CORS headers at all, so the lookup cannot be made from the page.
 * The archive host does allow cross-origin reads, but the signed link it hands back is
 * minted for whichever address asked for it — so resolving on the server and downloading
 * from the browser would be two different addresses. Both hops share this one route.
 */
function proxyUrl(target: string): string {
  return `/api/fetch-url?url=${encodeURIComponent(target)}`;
}

/** OCS reports sizes in KB; anything theme-sized reads better in MB. */
function formatSize(sizeKb: number): string {
  if (sizeKb <= 0) return '';
  return sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
}

export function ThemeLoader(props: { onThemeLoaded: (zip: JSZip, groups: IconGroup[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [storeUrl, setStoreUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [pickedUrl, setPickedUrl] = useState('');

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

  /**
   * Raises the blocking overlay for the duration of `work`.
   *
   * In a finally, so a failed read cannot leave the overlay standing over the error
   * message it is hiding.
   */
  async function withOverlay(work: () => Promise<void>) {
    setBusy(true);
    try {
      await paintBeforeWorking();
      await work();
    } finally {
      setBusy(false);
    }
  }

  /** The one download path, shared by the direct-URL field and both store routes. */
  async function loadArchiveFromUrl(target: string) {
    try {
      const response = await fetch(proxyUrl(target));
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
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await withOverlay(() => loadFromArchive(file.stream()));
  }

  async function handleFetchUrl() {
    if (!url) return;
    await withOverlay(() => loadArchiveFromUrl(url));
  }

  async function handleFetchStore() {
    if (!storeUrl) return;

    // Checked before the overlay goes up: a typo should answer instantly rather than
    // flash a "Reading theme…" card at a URL that was never going to be fetched.
    const id = parseStoreProductId(storeUrl);
    if (!id) {
      setProduct(null);
      setError('That is not a store.kde.org product page — paste a link such as https://store.kde.org/p/2344960.');
      return;
    }

    await withOverlay(async () => {
      let resolved: StoreProduct;
      try {
        const response = await fetch(proxyUrl(ocsProductUrl(id)));
        if (!response.ok) {
          setProduct(null);
          setError(`Could not reach the store (status ${response.status}).`);
          return;
        }
        resolved = parseStoreProduct(await response.json());
      } catch (err) {
        console.error('Failed to resolve store product:', err);
        setProduct(null);
        // parseStoreProduct's messages name the actual problem — an id that no longer
        // exists, or a product with nothing attached — so they are worth showing as-is.
        setError(err instanceof Error ? err.message : 'Could not look up that store product.');
        return;
      }

      setError(null);
      if (resolved.files.length === 1) {
        setProduct(null);
        await loadArchiveFromUrl(resolved.files[0].url);
        return;
      }

      // Several files under one product id are usually colour variants, which are
      // different themes wearing one page. Picking for the user would be guessing.
      setProduct(resolved);
      setPickedUrl(resolved.files[0].url);
    });
  }

  async function handleLoadSelected() {
    if (!pickedUrl) return;
    await withOverlay(() => loadArchiveFromUrl(pickedUrl));
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
        <label htmlFor="theme-url">Or fetch from a direct archive URL</label>
        <div className="loader__url">
          <input
            id="theme-url"
            type="text"
            placeholder="https://example.com/theme.tar.xz"
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
          />
          {/*
            * Both Fetch buttons read "Fetch" on screen, where the field above each one
            * says what is being fetched. A screen reader announces them out of that
            * context, so each carries the distinction in its accessible name.
            */}
          <button type="button" aria-label="Fetch archive URL" disabled={busy} onClick={handleFetchUrl}>Fetch</button>
        </div>
      </div>

      <div className="loader__field">
        <label htmlFor="theme-store-url">Or fetch from a store.kde.org URL</label>
        <div className="loader__url">
          <input
            id="theme-store-url"
            type="text"
            placeholder="https://store.kde.org/p/2344960"
            value={storeUrl}
            disabled={busy}
            onChange={(e) => setStoreUrl(e.target.value)}
          />
          <button type="button" aria-label="Fetch store product" disabled={busy} onClick={handleFetchStore}>Fetch</button>
        </div>
      </div>

      {product && (
        <div className="loader__variants">
          <p className="loader__variants-title">
            <strong>{product.name}</strong> publishes {product.files.length} downloads — pick one:
          </p>
          {/*
            * Labelled by attribute rather than by a visually-hidden <label>: the title
            * above already names the choice on screen, and the only .visually-hidden rule
            * lives in another component's stylesheet.
            */}
          <select
            aria-label="Which download"
            className="loader__variant-select"
            value={pickedUrl}
            disabled={busy}
            onChange={(e) => setPickedUrl(e.target.value)}
          >
            {product.files.map((file) => (
              // The size goes in the option text rather than beside it: a closed select
              // shows only the chosen option, so anything outside it is invisible at the
              // moment the choice is actually being made.
              <option key={file.url} value={file.url}>
                {formatSize(file.sizeKb) ? `${file.name} — ${formatSize(file.sizeKb)}` : file.name}
              </option>
            ))}
          </select>
          {/*
            * Loading stays behind its own button. Picking is free, but each of these is a
            * multi-megabyte download, and loading on change would start one for every
            * option a keyboard user arrows past on the way to the one they want.
            */}
          <button type="button" disabled={busy || !pickedUrl} onClick={handleLoadSelected}>
            Load selected
          </button>
        </div>
      )}

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

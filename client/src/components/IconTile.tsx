import { useEffect, useState } from 'react';
import type JSZip from 'jszip';
import type { IconVariant } from '../lib/theme/themeParser';

/** Sampled from a real Workbench screenshot: colour 0 of the standard palette. */
/**
 * The standard AmigaOS Workbench grey, sampled from a 3.2.3 screenshot.
 *
 * Must stay equal to `JobConfig.backgroundColor`'s default: conversion bakes soft edges
 * against that colour, so a preview grounded on any other grey shows a fringe the Amiga
 * will not.
 */
export const WORKBENCH_GREY = '#ABABAB';

const MIME: Record<IconVariant['format'], string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
};

type Loaded = { zipPath: string; status: 'ok'; src: string } | { zipPath: string; status: 'error' };

export function IconTile(props: {
  zip: JSZip;
  variant: IconVariant;
  checked: boolean;
  onToggle: (zipPath: string) => void;
  /**
   * Renders the icon's name between the preview and the category/size caption. On by
   * default nowhere: the gallery grid needs it (a card is identified by its name), the
   * variant picker does not (every tile in it shares one name, already in the heading).
   */
  showName?: boolean;
}) {
  const { zip, variant, checked, onToggle, showName = false } = props;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // JSZip's `file()` lookup is synchronous (it's an in-memory index, not I/O), so a
  // missing entry is known immediately during render — no need to round-trip it
  // through an effect and state just to report "not found".
  const file = zip.file(variant.zipPath);

  // The object URL is created on mount and revoked on unmount or variant change, so
  // only tiles the virtualizer is actually showing hold one. Materialising all 272k
  // at once would exhaust the tab.
  useEffect(() => {
    // Looked up again here (rather than closing over the `file` computed above) so
    // this effect's only real dependencies are `zip` and `variant.zipPath` — both
    // already listed below.
    const entry = zip.file(variant.zipPath);
    if (!entry) return;

    let url: string | null = null;
    let cancelled = false;

    entry
      .async('blob')
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob.slice(0, blob.size, MIME[variant.format]));
        setLoaded({ zipPath: variant.zipPath, status: 'ok', src: url });
      })
      .catch(() => {
        // Corrupted entry / decompression failure — plausible at 272k-file scale.
        // Surface it instead of leaving an unhandled rejection and a blank tile.
        if (!cancelled) setLoaded({ zipPath: variant.zipPath, status: 'error' });
      });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [zip, variant.zipPath, variant.format]);

  // A `loaded` result only applies to the variant it was fetched for. Once the variant
  // prop changes, any previous result — from the icon just swapped away from — falls
  // through to the loading state below rather than requiring a synchronous setState
  // reset inside the effect above.
  const state: Loaded | { status: 'loading' } = !file
    ? { zipPath: variant.zipPath, status: 'error' }
    : loaded && loaded.zipPath === variant.zipPath
      ? loaded
      : { status: 'loading' };

  return (
    <label className="icon-tile">
      <input className="icon-tile__check" type="checkbox" checked={checked} onChange={() => onToggle(variant.zipPath)} />
      <span className="icon-tile__swatch" style={{ backgroundColor: WORKBENCH_GREY }}>
        {state.status === 'ok' && (
          <img
            src={state.src}
            alt={variant.name}
            width={48}
            height={48}
            loading="lazy"
            onError={() => setLoaded({ zipPath: variant.zipPath, status: 'error' })}
          />
        )}
        {state.status === 'error' && (
          // `status`, not `alert`: with virtualization, scrolling through a stretch of
          // broken entries mounts tile after tile, and `alert` would fire an assertive
          // screen-reader interruption for every one of them. The text is visible either
          // way; a polite live region is the right weight for "this thumbnail didn't load".
          <span role="status">{`${variant.name} failed to load`}</span>
        )}
      </span>
      {showName && <span className="icon-tile__name">{variant.name}</span>}
      {/*
        `sizePx` is 0 for a scalable SVG, so a raw render reads "places 0" — and this is
        the label the user picks a variant by, which makes a meaningless number actively
        misleading rather than merely untidy.
      */}
      <small className="icon-tile__meta">
        {`${variant.category} ${variant.sizePx === 0 ? 'scalable' : variant.sizePx}`}
      </small>
    </label>
  );
}

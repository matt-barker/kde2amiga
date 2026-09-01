import { useEffect, useState } from 'react';
import type JSZip from 'jszip';
import type { IconVariant } from '../lib/theme/themeParser';

/** Sampled from a real Workbench screenshot: colour 0 of the standard palette. */
export const WORKBENCH_GREY = '#AAAAAA';

const MIME: Record<IconVariant['format'], string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
};

export function IconTile(props: {
  zip: JSZip;
  variant: IconVariant;
  checked: boolean;
  onToggle: (zipPath: string) => void;
}) {
  const { zip, variant, checked, onToggle } = props;
  const [src, setSrc] = useState<string | null>(null);

  // The object URL is created on mount and revoked on unmount, so only tiles the
  // virtualizer is actually showing hold one. Materialising all 272k at once would
  // exhaust the tab.
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;

    const file = zip.file(variant.zipPath);
    if (file) {
      file.async('blob').then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob.slice(0, blob.size, MIME[variant.format]));
        setSrc(url);
      });
    }

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [zip, variant.zipPath, variant.format]);

  return (
    <label>
      <input type="checkbox" checked={checked} onChange={() => onToggle(variant.zipPath)} />
      <span style={{ backgroundColor: WORKBENCH_GREY, display: 'inline-block', padding: 4 }}>
        {src && <img src={src} alt={variant.name} width={48} height={48} loading="lazy" />}
      </span>
      <small>{`${variant.category} ${variant.sizePx}`}</small>
    </label>
  );
}

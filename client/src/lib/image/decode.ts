import type { RgbaImage } from './quantize';

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawToRgbaImage(img: HTMLImageElement, outputSizePx: number): RgbaImage {
  const canvas = document.createElement('canvas');
  canvas.width = outputSizePx;
  canvas.height = outputSizePx;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, outputSizePx, outputSizePx);
  ctx.drawImage(img, 0, 0, outputSizePx, outputSizePx);
  const imageData = ctx.getImageData(0, 0, outputSizePx, outputSizePx);
  return { width: outputSizePx, height: outputSizePx, data: imageData.data };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Reads an SVG length attribute as user units, ignoring an absolute unit suffix. */
function parseSvgLength(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  // Relative lengths ("100%", "2em") have no fixed user-unit value to derive a
  // viewBox from, so they are deliberately rejected rather than guessed at.
  const match = raw.trim().match(/^([0-9]*\.?[0-9]+)(?:px|pt|pc|mm|cm|in|q)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function readAttribute(openingTag: string, name: string): string | undefined {
  return openingTag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'))?.[1];
}

/**
 * Pins an SVG's viewport to `size` without changing what the drawing covers.
 *
 * Two shapes need handling, and conflating them is what produced top-left-cropped
 * icons on the Amiga:
 *
 * - **viewBox but no width/height.** No reliable intrinsic size: browsers disagree
 *   on the fallback (the 300x150 default versus the viewBox), and librsvg rejects
 *   it outright. Real MDI badges and some KDE theme icons are shaped this way, so
 *   the dimensions have to be pinned before rasterizing.
 * - **width/height but no viewBox.** Every Papirus icon is shaped this way, as are
 *   14 icons in kora. Here `width`/`height` are doing double duty: they set the
 *   viewport *and*, absent a viewBox, they are the only thing establishing the user
 *   coordinate system. Overwriting them therefore shrinks the clip rectangle while
 *   leaving the artwork at its original scale, so a 64-unit drawing rendered at 32
 *   keeps exactly its top-left quarter. Deriving a viewBox from the original
 *   dimensions first preserves the coordinate system, so the drawing scales.
 *
 * A relative width ("100%") yields no user-unit extent to derive from; those keep
 * today's behaviour rather than being given an invented viewBox.
 */
function ensureSvgSize(svgText: string, size: number): string {
  return svgText.replace(/<svg\b[^>]*>/, (openingTag) => {
    let sized = openingTag
      .replace(/\s(?:width|height)="[^"]*"/g, '')
      .replace(/<svg\b/, `<svg width="${size}" height="${size}"`);

    if (!/\sviewBox="/i.test(openingTag)) {
      const width = parseSvgLength(readAttribute(openingTag, 'width'));
      const height = parseSvgLength(readAttribute(openingTag, 'height'));
      if (width !== null && height !== null) {
        sized = sized.replace(/<svg\b/, `<svg viewBox="0 0 ${width} ${height}"`);
      }
    }
    return sized;
  });
}

export async function rasterizeSvg(svgText: string, outputSizePx: number): Promise<RgbaImage> {
  const base64 = bytesToBase64(new TextEncoder().encode(ensureSvgSize(svgText, outputSizePx)));
  const url = `data:image/svg+xml;base64,${base64}`;
  const img = await loadImageElement(url);
  return drawToRgbaImage(img, outputSizePx);
}

export async function decodePng(bytes: Uint8Array, outputSizePx: number): Promise<RgbaImage> {
  const base64 = bytesToBase64(bytes);
  const url = `data:image/png;base64,${base64}`;
  const img = await loadImageElement(url);
  return drawToRgbaImage(img, outputSizePx);
}

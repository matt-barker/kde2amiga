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

/**
 * A viewBox-only SVG has no reliable intrinsic size: browsers disagree on the
 * fallback (the 300x150 default versus the viewBox), and librsvg rejects it
 * outright. Real MDI badges and some KDE theme icons are shaped this way, so
 * pin the dimensions before rasterizing.
 */
function ensureSvgSize(svgText: string, size: number): string {
  return svgText.replace(/<svg\b[^>]*>/, (openingTag) =>
    openingTag
      .replace(/\s(?:width|height)="[^"]*"/g, '')
      .replace(/<svg\b/, `<svg width="${size}" height="${size}"`),
  );
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

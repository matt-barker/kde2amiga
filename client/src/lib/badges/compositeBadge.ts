import type { RgbaImage } from '../image/quantize';
import { rasterizeSvg } from '../image/decode';

export type BadgeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export interface BadgeOptions {
  svgText: string;
  color: string;
  corner: BadgeCorner;
  scale: number;
  outline?: string;
  dropShadow?: boolean;
}

function recolorSvg(svgText: string, color: string, outline?: string): string {
  let recolored = svgText.replace(/fill="[^"]*"/g, `fill="${color}"`).replace(/fill:\s*[^;"]+/g, `fill:${color}`);
  if (outline) {
    recolored = recolored.replace('<svg', `<svg stroke="${outline}" stroke-width="1"`);
  }
  return recolored;
}

/**
 * MDI badge SVGs carry only a viewBox, with no intrinsic size. Browsers
 * disagree on what an unsized SVG's dimensions are when loaded via <img>,
 * so pin them explicitly to keep rasterization deterministic.
 */
function ensureSvgSize(svgText: string, size: number): string {
  return svgText.replace(/<svg\b[^>]*>/, (openingTag) =>
    openingTag
      .replace(/\s(?:width|height)="[^"]*"/g, '')
      .replace(/<svg\b/, `<svg width="${size}" height="${size}"`),
  );
}

function cornerOffset(corner: BadgeCorner, baseSize: number, badgeSize: number): { x: number; y: number } {
  const margin = 0;
  switch (corner) {
    case 'top-left': return { x: margin, y: margin };
    case 'top-right': return { x: baseSize - badgeSize - margin, y: margin };
    case 'bottom-left': return { x: margin, y: baseSize - badgeSize - margin };
    case 'bottom-right': return { x: baseSize - badgeSize - margin, y: baseSize - badgeSize - margin };
    case 'center': return { x: (baseSize - badgeSize) / 2, y: (baseSize - badgeSize) / 2 };
  }
}

export async function compositeBadge(base: RgbaImage, options: BadgeOptions): Promise<RgbaImage> {
  const { svgText, color, corner, scale, outline, dropShadow } = options;
  const badgeSize = Math.round(base.width * scale);
  const recoloredSvg = recolorSvg(svgText, color, outline);
  const badge = await rasterizeSvg(ensureSvgSize(recoloredSvg, badgeSize), badgeSize);
  const { x: offsetX, y: offsetY } = cornerOffset(corner, base.width, badgeSize);

  const canvas = document.createElement('canvas');
  canvas.width = base.width;
  canvas.height = base.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(base.data, base.width, base.height), 0, 0);

  const badgeCanvas = document.createElement('canvas');
  badgeCanvas.width = badgeSize;
  badgeCanvas.height = badgeSize;
  const badgeCtx = badgeCanvas.getContext('2d')!;
  badgeCtx.putImageData(new ImageData(badge.data, badge.width, badge.height), 0, 0);

  if (dropShadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = Math.max(2, Math.round(badgeSize * 0.08));
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.drawImage(badgeCanvas, offsetX, offsetY);
    ctx.restore();
  } else {
    ctx.drawImage(badgeCanvas, offsetX, offsetY);
  }

  const composited = ctx.getImageData(0, 0, base.width, base.height);
  return { width: base.width, height: base.height, data: composited.data };
}

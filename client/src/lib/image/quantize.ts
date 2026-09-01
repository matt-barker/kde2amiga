import { maxColorsForSingleLine } from '../newicons/paletteLimits';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

type Rgb = [number, number, number];

/**
 * Alpha at or above which a source pixel is drawn at all.
 *
 * NewIcons has no partial alpha — index 0 is transparent and every other index is
 * paint at full strength — so each source pixel has to be resolved to drawn or not
 * drawn. The old rule, "anything above zero is drawn", made that decision the most
 * damaging way available: modern themes lean on wide, very faint drop shadows and
 * anti-aliased skirts, and those came through as solid paint. Measured at 32px on
 * Slot-Symbolic-Dark, the share of pixels in the 1-127 band runs from 6%
 * (preferences-desktop-gaming) to 41% (utilities-tweak-tool) — a haze that
 * swallowed each artwork's silhouette against the Workbench's grey. It also cost
 * real colours: those pixels fed the median cut, so the palette spent slots on
 * shades nothing visible used.
 *
 * Half opacity is the conventional cut for flattening to 1-bit alpha: it keeps
 * anti-aliased edges, which cluster high, and drops shadows, which cluster low.
 * With it, only 8 of preferences-desktop-gaming's 561 drawn pixels land within
 * distance 40 of Workbench grey (#ABABAB) — the icon reads as artwork again.
 */
export const MIN_DRAWN_ALPHA = 128;

function collectOpaquePixels(images: RgbaImage[]): Rgb[] {
  const pixels: Rgb[] = [];
  for (const image of images) {
    for (let i = 0; i < image.data.length; i += 4) {
      if (image.data[i + 3] >= MIN_DRAWN_ALPHA) {
        pixels.push([image.data[i], image.data[i + 1], image.data[i + 2]]);
      }
    }
  }
  return pixels;
}

function widestChannel(pixels: Rgb[]): 0 | 1 | 2 {
  const min: Rgb = [255, 255, 255];
  const max: Rgb = [0, 0, 0];
  for (const [r, g, b] of pixels) {
    min[0] = Math.min(min[0], r); max[0] = Math.max(max[0], r);
    min[1] = Math.min(min[1], g); max[1] = Math.max(max[1], g);
    min[2] = Math.min(min[2], b); max[2] = Math.max(max[2], b);
  }
  const ranges = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const widest = ranges.indexOf(Math.max(...ranges));
  return widest as 0 | 1 | 2;
}

function medianCut(pixels: Rgb[], targetCount: number): Rgb[][] {
  const buckets: Rgb[][] = [pixels];
  while (buckets.length < targetCount) {
    let splitIndex = -1;
    let splitSize = 0;
    buckets.forEach((bucket, i) => {
      if (bucket.length > splitSize && bucket.length > 1) {
        splitSize = bucket.length;
        splitIndex = i;
      }
    });
    if (splitIndex === -1) break; // nothing left worth splitting

    const bucket = buckets[splitIndex];
    const channel = widestChannel(bucket);
    bucket.sort((a, b) => a[channel] - b[channel]);
    const mid = Math.floor(bucket.length / 2);
    buckets.splice(splitIndex, 1, bucket.slice(0, mid), bucket.slice(mid));
  }
  return buckets;
}

function average(bucket: Rgb[]): Rgb {
  const sum = bucket.reduce((acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b], [0, 0, 0]);
  return [
    Math.round(sum[0] / bucket.length),
    Math.round(sum[1] / bucket.length),
    Math.round(sum[2] / bucket.length),
  ];
}

export function buildSharedPalette(images: RgbaImage[], maxColors: number): Rgb[] {
  const cap = Math.min(maxColors, maxColorsForSingleLine());
  const pixels = collectOpaquePixels(images);
  const palette: Rgb[] = [[0, 0, 0]]; // reserved transparent/background slot

  if (pixels.length === 0) return palette;

  const remainingSlots = Math.max(cap - 1, 0);
  if (remainingSlots === 0) return palette;

  const buckets = medianCut(pixels, remainingSlots).filter((b) => b.length > 0);
  for (const bucket of buckets) palette.push(average(bucket));
  return palette.slice(0, cap);
}

function colorDistance(a: Rgb, b: Rgb): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

export function mapImageToPalette(image: RgbaImage, palette: Rgb[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] < MIN_DRAWN_ALPHA) {
      indices.push(0);
      continue;
    }
    const pixel: Rgb = [image.data[i], image.data[i + 1], image.data[i + 2]];
    const startIndex = palette.length > 1 ? 1 : 0;
    let bestIndex = startIndex;
    let bestDistance = Infinity;
    for (let index = startIndex; index < palette.length; index++) {
      const distance = colorDistance(pixel, palette[index]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    indices.push(bestIndex);
  }
  return indices;
}

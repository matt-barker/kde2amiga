import { maxColorsForSingleLine } from '../newicons/paletteLimits';
import { bayerFraction, buildDrawnMask } from './dither';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

type Rgb = [number, number, number];

/**
 * The colours that will actually appear, as decided by `buildDrawnMask`.
 *
 * Asking the mask rather than re-testing alpha here is what keeps the palette and
 * the mapping from disagreeing. They resolve alpha in separate passes, so any
 * difference between their rules would spend scarce Amiga colours on pixels that
 * never get drawn — which is exactly how faint drop shadows used to poison the
 * median cut.
 */
function collectDrawnPixels(images: RgbaImage[]): Rgb[] {
  const pixels: Rgb[] = [];
  for (const image of images) {
    const mask = buildDrawnMask(image);
    for (let pixel = 0; pixel < mask.length; pixel++) {
      if (!mask[pixel]) continue;
      const i = pixel * 4;
      pixels.push([image.data[i], image.data[i + 1], image.data[i + 2]]);
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
  const pixels = collectDrawnPixels(images);
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

/**
 * How far apart two palette entries may be and still be dithered together.
 *
 * A checkerboard only reads as the colour in between when its two colours are close;
 * past that it reads as speckle. GlowIcons stays well inside this — the dithered
 * monitor screen in its ScreenMode icon alternates 5181b0 with 6190c0, a span of 27.
 * Without a cap, a palette too small to hold an icon's hues starts blending across
 * them, which scattered yellow dots over the red paper in the folder icons: half the
 * pixels took a large colour error to correct a small average one.
 *
 * Squared, to compare against `colorDistance` without a square root.
 */
const MAX_DITHER_SPAN_SQUARED = 64 * 64;

/**
 * Maps an image onto `palette`, dithering between palette entries.
 *
 * The palette ceiling here is brutal and fixed: a NewIcons palette has to fit on the
 * first ToolType line, which caps it at 34 entries for the whole batch, so a single
 * icon typically gets a dozen. Snapping each pixel to its nearest entry spends that
 * budget on hard bands across every gradient the source artwork has.
 *
 * So pick the *two* nearest entries and alternate between them, at a density set by
 * where the pixel actually falls on the line between them. A region halfway between
 * two blues becomes a checkerboard of both, which at icon size reads as the colour
 * in between — the trick GlowIcons uses to draw a graded monitor screen out of
 * 5181b0 and 6190c0 alone.
 *
 * Two properties keep this from adding noise where none is wanted. The projection is
 * clamped at the endpoints, so a pixel that matches an entry exactly has no residual
 * and never dithers — flat artwork stays flat. And the search starts past index 0,
 * which is a hole rather than a colour, so nothing can blend into transparency.
 */
export function mapImageToPalette(image: RgbaImage, palette: Rgb[]): number[] {
  const mask = buildDrawnMask(image);
  const startIndex = palette.length > 1 ? 1 : 0;
  const indices: number[] = [];

  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (!mask[pixel]) {
      indices.push(0);
      continue;
    }
    const i = pixel * 4;
    const color: Rgb = [image.data[i], image.data[i + 1], image.data[i + 2]];

    let nearest = startIndex;
    let nearestDistance = Infinity;
    let second = -1;
    let secondDistance = Infinity;
    for (let index = startIndex; index < palette.length; index++) {
      const distance = colorDistance(color, palette[index]);
      if (distance < nearestDistance) {
        second = nearest;
        secondDistance = nearestDistance;
        nearest = index;
        nearestDistance = distance;
      } else if (distance < secondDistance) {
        second = index;
        secondDistance = distance;
      }
    }
    if (second < startIndex) {
      indices.push(nearest);
      continue;
    }

    // How far along the line from the nearest entry to the second the pixel sits.
    const from = palette[nearest];
    const to = palette[second];
    const spanR = to[0] - from[0];
    const spanG = to[1] - from[1];
    const spanB = to[2] - from[2];
    const spanLengthSquared = spanR * spanR + spanG * spanG + spanB * spanB;
    if (spanLengthSquared === 0 || spanLengthSquared > MAX_DITHER_SPAN_SQUARED) {
      indices.push(nearest);
      continue;
    }
    const along =
      ((color[0] - from[0]) * spanR +
        (color[1] - from[1]) * spanG +
        (color[2] - from[2]) * spanB) /
      spanLengthSquared;

    const x = pixel % image.width;
    const y = (pixel / image.width) | 0;
    indices.push(along > bayerFraction(x, y) ? second : nearest);
  }
  return indices;
}

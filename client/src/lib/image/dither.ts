import type { RgbaImage } from './quantize';

/**
 * Bayer 4x4, the classic ordered-dither cell.
 *
 * Every value 0-15 appears exactly once, and adjacent entries are far apart in
 * rank, so a region that resolves partly one way and partly the other comes out as
 * an even checkerboard rather than as stripes or clumps. That regularity is what
 * makes a dithered area read as a blend at icon size.
 */
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Width and height of the dither cell; the pattern tiles at this period. */
export const CELL = 4;

/**
 * Where this pixel sits in the dither order, as a fraction strictly between 0 and 1.
 *
 * Used as the threshold a blend has to beat to take the further of two palette
 * colours. The half-step offset centres each threshold inside its band, so a colour
 * exactly midway between two entries splits the cell evenly, and neither endpoint
 * ever triggers: a pixel that matches a palette entry exactly is never dithered.
 */
export function bayerFraction(x: number, y: number): number {
  return (BAYER_4X4[y % CELL][x % CELL] + 0.5) / (CELL * CELL);
}

/**
 * Alpha at or above which a pixel is drawn.
 *
 * NewIcons has no partial alpha, so coverage has to collapse to drawn or not drawn.
 * Dithering this channel was tried and abandoned: in flat vector artwork almost all
 * sub-cutoff alpha is the one-pixel anti-aliasing fringe, so it changed under 4% of
 * an icon — invisible — while perforating the flat translucent fills these themes
 * use for interior detail, such as the three bars inside Slot-Symbolic-Dark's music
 * icon. Dithering pays off on colour, where the palette ceiling actually binds.
 */
const SOLID_ALPHA = 128;

/**
 * Resolves each pixel of `image` to drawn (1) or not drawn (0).
 *
 * Exists as a shared step so the palette builder and the palette mapper cannot
 * disagree about which pixels are real. They walk the image in separate passes, and
 * any difference between their rules would spend scarce palette slots on colours
 * that never appear — which is how faint drop shadows once poisoned the median cut.
 */
export function buildDrawnMask(image: RgbaImage): Uint8Array {
  const mask = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < mask.length; pixel++) {
    mask[pixel] = image.data[pixel * 4 + 3] >= SOLID_ALPHA ? 1 : 0;
  }
  return mask;
}

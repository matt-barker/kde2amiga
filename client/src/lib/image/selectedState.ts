import { bayerFraction } from './dither';

export type SelectedStateEffect = 'brighten' | 'darken' | 'tint' | 'glowSurround';

type Rgb = [number, number, number];

/**
 * The halo GlowIcons draws around a selected icon, from the artwork outward.
 *
 * Decoded from a Workbench 3.2.3 screenshot rather than guessed at: isolating the
 * ReAction icon's silhouette and running a Manhattan distance transform outward from
 * it puts every one of the 152 white pixels at distance 1, all 135 bright-yellow at 2,
 * and all 109 solid pale-gold at 3 — no exceptions in either direction. Distance 4 is
 * the same gold at half coverage, and nothing is drawn past it.
 */
export const GLOWICONS_RAMP: Rgb[] = [
  [255, 255, 255],
  [239, 231, 23],
  [223, 187, 71],
];

/**
 * The grey a derived ramp fades its outer stop into.
 *
 * GlowIcons' third stop is not a darkening of its second — it is that yellow washed
 * toward the Workbench grey it is drawn against, which is what makes the halo read as
 * fading out rather than as a dark rim. A ramp derived from some other colour has to
 * fade toward the same ground to keep that behaviour.
 */
const WORKBENCH_GREY: Rgb = [0xab, 0xab, 0xab];

/** How thick GlowIcons' halo is, and the artwork box it was measured in. */
const GLOWICONS_HALO_PX = 4;
const GLOWICONS_BOX_PX = 48;

function mix([r, g, b]: Rgb, [tr, tg, tb]: Rgb, t: number): Rgb {
  return [
    Math.round(r + (tr - r) * t),
    Math.round(g + (tg - g) * t),
    Math.round(b + (tb - b) * t),
  ];
}

/**
 * How many rings of halo an icon of this size gets.
 *
 * Holding GlowIcons' 4px-in-48 ratio rather than fixing the thickness keeps the glow
 * reading the same relative to the artwork at every offered size: a flat 4px would
 * swallow a 24px icon and all but disappear on a 128px one. The floor of one ring
 * matters because that single white ring is exactly what this effect drew before it
 * was graded, so tiny icons degrade to the old behaviour instead of to nothing.
 */
export function glowRadiusFor(sizePx: number): number {
  return Math.max(1, Math.round((sizePx * GLOWICONS_HALO_PX) / GLOWICONS_BOX_PX));
}

/**
 * The three colours a halo ramps through, innermost first.
 *
 * With no colour chosen this is GlowIcons' own ramp, verbatim, so the default output
 * matches theirs. A chosen colour keeps the middle stop — the one the eye reads as
 * "the glow" — and gets a lightened core inside it and a ground-washed stop outside,
 * which is the same shape as the ramp GlowIcons built around its yellow.
 */
export function glowRamp(glowColor?: Rgb): Rgb[] {
  if (!glowColor) return GLOWICONS_RAMP;
  return [mix(glowColor, [255, 255, 255], 0.6), glowColor, mix(glowColor, WORKBENCH_GREY, 0.35)];
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, n));
}

function nearestPaletteIndex(color: Rgb, palette: Rgb[]): number {
  // Index 0 is the reserved transparent slot; never let a transformed foreground colour
  // re-snap onto it, mirroring quantize.ts's buildSharedPalette.
  const startIndex = palette.length > 1 ? 1 : 0;
  let bestIndex = startIndex;
  let bestDistance = Infinity;
  palette.forEach((candidate, index) => {
    if (index < startIndex) return;
    const distance =
      (candidate[0] - color[0]) ** 2 + (candidate[1] - color[1]) ** 2 + (candidate[2] - color[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function transformColor(effect: SelectedStateEffect, [r, g, b]: Rgb, tintColor?: Rgb): Rgb {
  switch (effect) {
    case 'brighten':
      return [clamp(r + 60), clamp(g + 60), clamp(b + 60)];
    case 'darken':
      return [clamp(r - 60), clamp(g - 60), clamp(b - 60)];
    case 'tint': {
      const [tr, tg, tb] = tintColor ?? [255, 255, 0];
      return [clamp((r + tr) / 2), clamp((g + tg) / 2), clamp((b + tb) / 2)];
    }
    case 'glowSurround':
      return [r, g, b]; // interior pixels unchanged; border handled separately below
  }
}

/**
 * Manhattan distance from every pixel to the nearest drawn one, saturating past `limit`.
 *
 * Two sweeps — one down-right, one up-left — are enough for a 4-connected metric, which
 * is the metric GlowIcons uses: in the decoded screenshot a diagonal neighbour of the
 * artwork sits on the second ring, not the first, so corners do not count as adjacency.
 * Saturating rather than tracking true distances keeps the values small and means the
 * cost does not grow with the size of the transparent margin.
 */
function distanceToArtwork(pixels: number[], width: number, height: number, limit: number): Int32Array {
  const beyond = limit + 1;
  const distance = new Int32Array(width * height);
  for (let i = 0; i < distance.length; i++) distance[i] = pixels[i] !== 0 ? 0 : beyond;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (y > 0) distance[i] = Math.min(distance[i], distance[i - width] + 1);
      if (x > 0) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (y < height - 1) distance[i] = Math.min(distance[i], distance[i + width] + 1);
      if (x < width - 1) distance[i] = Math.min(distance[i], distance[i + 1] + 1);
    }
  }
  return distance;
}

/** Conceptual bands in the halo: the three ramp stops, plus the outer stop dithered. */
const HALO_BANDS = 4;

export function applySelectedStateEffect(
  effect: SelectedStateEffect,
  palette: Rgb[],
  pixels: number[],
  width: number,
  height: number,
  tintColor?: Rgb,
  glowColor?: Rgb,
): number[] {
  const remapCache = new Map<number, number>();
  const remap = (index: number): number => {
    if (index === 0) return 0;
    const cached = remapCache.get(index);
    if (cached !== undefined) return cached;
    const transformed = transformColor(effect, palette[index], tintColor);
    const newIndex = nearestPaletteIndex(transformed, palette);
    remapCache.set(index, newIndex);
    return newIndex;
  };

  const result = pixels.map(remap);

  if (effect === 'glowSurround') {
    /*
     * The halo GlowIcons draws, rather than the single-pixel outline this once grew.
     *
     * Decoded from a Workbench 3.2.3 screenshot: rings of white, bright yellow and pale
     * gold at Manhattan distance 1, 2 and 3 from the artwork, then the same gold at half
     * coverage at distance 4, then nothing. The ramp colours are looked up rather than
     * assumed present because both states of an .info share one palette — `prepareIcon`
     * reserves slots for them, which makes these lookups exact, but asking for the
     * nearest entry keeps the function honest if it is ever handed a palette with no
     * room. Nothing can land on index 0: that is the transparency hole, and a glow drawn
     * there would simply be invisible.
     */
    const rampIndices = glowRamp(glowColor).map((color) => nearestPaletteIndex(color, palette));
    // The pipeline only ever produces square canvases, sized to the requested output.
    const radius = glowRadiusFor(Math.max(width, height));
    const distance = distanceToArtwork(result, width, height, radius);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const rings = distance[i];
        if (rings < 1 || rings > radius) continue;
        /*
         * Stretch the four bands across whatever radius this size affords. Dividing by at
         * least HALO_BANDS means a radius too small for every band truncates the ramp from
         * the outside in — a 2px halo is core and middle, not all three squeezed into two
         * — so small icons lose the faintest stop rather than the structure. A radius of
         * one leaves just the white core, which is exactly what this effect drew before it
         * was graded.
         */
        const band = Math.min(
          HALO_BANDS - 1,
          Math.floor(((rings - 1) * HALO_BANDS) / Math.max(radius, HALO_BANDS)),
        );
        // The outermost band is the outer stop at half coverage. 1-bit transparency cannot
        // fade, so the falloff buys its last level from the same ordered-dither cell the
        // palette mapper uses; at 50% the Bayer 4x4 resolves to a plain 2x2 checker.
        if (band === HALO_BANDS - 1 && bayerFraction(x, y) >= 0.5) continue;
        result[i] = rampIndices[Math.min(band, rampIndices.length - 1)];
      }
    }
  }

  return result;
}

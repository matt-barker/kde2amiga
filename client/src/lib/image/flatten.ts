import type { RgbaImage } from './quantize';

/**
 * The faintest pixel worth keeping once it has been blended into the background.
 *
 * Flattening makes partial alpha opaque, so without a floor the widest and faintest
 * reaches of a drop shadow all survive as pixels that are almost pure background
 * colour. On the backdrop they were flattened against that is invisible, but it is a
 * halo on any other, and it spends scarce palette slots on shades of the backdrop.
 *
 * At 12/255 a pixel is under 5% ink, which is past the point where the blend differs
 * from the background by enough to matter at a 34-colour palette's resolution.
 */
export const MIN_FLATTENED_ALPHA = 12;

/**
 * Bakes partial alpha into opaque colour by compositing it over `background`.
 *
 * NewIcons transparency is 1-bit, so a silhouette cannot be anti-aliased the way the
 * source SVG is: each edge pixel is either fully drawn or fully absent, which is what
 * leaves converted icons looking stair-stepped. Compositing the anti-aliased fringe
 * against the colour the icon will actually sit on recovers that smoothness, at the
 * cost of assuming the backdrop.
 *
 * That assumption is what the reference icons make too. AmigaOS 3.2's GlowIcons carry
 * an opaque, dithered grey drop shadow — sampled off the Presets icon, its edge pixels
 * are #818181 and #4E4E4E — which reads as a soft fade on the standard Workbench grey
 * and as a grey fringe on anything else. So this is deliberately optional: callers pass
 * the backdrop they are targeting, or skip flattening entirely and keep hard edges that
 * are honest on any background.
 *
 * Returns a new image; the input is left alone.
 */
export function flattenOntoBackground(
  image: RgbaImage,
  background: [number, number, number],
): RgbaImage {
  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0 || alpha === 255) continue;
    if (alpha < MIN_FLATTENED_ALPHA) {
      data[i + 3] = 0;
      continue;
    }
    const ink = alpha / 255;
    for (let channel = 0; channel < 3; channel++) {
      data[i + channel] = Math.round(data[i + channel] * ink + background[channel] * (1 - ink));
    }
    data[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data: data as RgbaImage['data'] };
}

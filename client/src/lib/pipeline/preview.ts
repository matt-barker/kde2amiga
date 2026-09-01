import type JSZip from 'jszip';
import type { IconVariant } from '../theme/themeParser';
import { buildSharedPalette, type RgbaImage } from '../image/quantize';
import { decodeThemeIcon, paletteIndicesFor, type JobConfig } from './convertJob';

export interface IconPreview {
  zipPath: string;
  width: number;
  height: number;
  normal: ImageData;
  selected: ImageData;
}

/** Paints palette indices back out as RGBA, leaving index 0 fully transparent. */
function toImageData(
  indices: number[],
  palette: [number, number, number][],
  width: number,
  height: number,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i];
    const offset = i * 4;
    if (index === 0) continue; // transparent slot; leave the RGBA zeroed
    const [r, g, b] = palette[index] ?? [0, 0, 0];
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
  }
  return new ImageData(data, width, height);
}

/**
 * How many icons are decoded between yields back to the browser's event loop.
 *
 * `await` alone is not enough: `decodeThemeIcon`'s promises settle on the microtask
 * queue, which the browser drains without ever getting a chance to paint or handle
 * input. A macrotask (`setTimeout(0)`) is what actually lets the tab breathe, so a
 * few-hundred-icon selection cannot freeze it.
 */
const YIELD_EVERY = 8;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Renders exactly what conversion would produce for the current selection.
 *
 * The palette is built once across every selected icon, matching `runConversionJob`.
 * That is why previews are recomputed whenever the selection or config changes: adding
 * or removing an icon changes the shared palette and therefore every other preview.
 *
 * That pixel-for-pixel identity with `runConversionJob` is the branch's Global
 * Constraint, and it is pinned by the "preview / conversion pixel identity" test in
 * preview.test.ts — which runs the real conversion, decodes the .info bytes back out of
 * the output zip with the upstream-ported decoder, and compares. Any stage added to one
 * path must be added to the other, or that test fails.
 *
 * Known gap, deliberately left open: `runConversionJob` applies `compositeBadge` before
 * quantization when a `JobIconInput` carries a badge. This function takes `IconVariant[]`
 * rather than `JobIconInput[]`, so it structurally cannot. Badges are unwired today (no
 * UI ever sets one), so the two paths agree in practice and the identity test passes —
 * but wiring the badge UI up without also giving previews the badge will silently break
 * that identity, and the identity test is the thing that will tell you.
 *
 * Also deliberately deferred: progressive/incremental emission of previews as each icon
 * finishes (spec §4). This builds the whole batch and resolves once. That is an omission,
 * not an oversight — the yields below are enough to keep the tab responsive, and
 * streaming results out is a feature-shaped change that belongs in its own task.
 */
export async function buildPreviews(
  zip: JSZip,
  variants: IconVariant[],
  config: JobConfig,
): Promise<IconPreview[]> {
  const decoded: Array<{ variant: IconVariant; image: RgbaImage }> = [];

  for (const [index, variant] of variants.entries()) {
    if (index > 0 && index % YIELD_EVERY === 0) await yieldToEventLoop();
    try {
      decoded.push({ variant, image: await decodeThemeIcon(zip, variant, config.outputSizePx) });
    } catch (error) {
      console.warn(`Skipping preview for "${variant.name}": ${(error as Error).message}`);
    }
  }

  const palette = buildSharedPalette(decoded.map((d) => d.image), config.maxColors);

  return decoded.map(({ variant, image }) => {
    const { normal, selected } = paletteIndicesFor(image, palette, config);
    return {
      zipPath: variant.zipPath,
      width: image.width,
      height: image.height,
      normal: toImageData(normal, palette, image.width, image.height),
      selected: toImageData(selected, palette, image.width, image.height),
    };
  });
}

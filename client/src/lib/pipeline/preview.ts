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
 * Renders exactly what conversion would produce for the current selection.
 *
 * The palette is built once across every selected icon, matching `runConversionJob`.
 * That is why previews are recomputed whenever the selection or config changes: adding
 * or removing an icon changes the shared palette and therefore every other preview.
 */
export async function buildPreviews(
  zip: JSZip,
  variants: IconVariant[],
  config: JobConfig,
): Promise<IconPreview[]> {
  const decoded: Array<{ variant: IconVariant; image: RgbaImage }> = [];

  for (const variant of variants) {
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

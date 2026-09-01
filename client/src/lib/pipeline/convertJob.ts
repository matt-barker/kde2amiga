import type JSZip from 'jszip';
import type { IconVariant } from '../theme/themeParser';
import { rasterizeSvg, decodePng } from '../image/decode';
import { compositeBadge, type BadgeOptions } from '../badges/compositeBadge';
import { buildSharedPalette, mapImageToPalette, type RgbaImage } from '../image/quantize';
import { maxColorsForSingleLine } from '../newicons/paletteLimits';
import { flattenOntoBackground } from '../image/flatten';
import { applySelectedStateEffect, type SelectedStateEffect } from '../image/selectedState';
import { buildInfoFile, type IconKind } from '../newicons/diskObject';
import { buildOutputZip, type ConvertedIcon } from '../output/zipBuilder';

export interface JobIconInput {
  icon: IconVariant;
  kind: IconKind;
  role?: ConvertedIcon['role'];
  badge?: BadgeOptions;
}

export interface JobConfig {
  outputSizePx: number;
  maxColors: number;
  selectedEffect: SelectedStateEffect;
  tintColor?: [number, number, number];
  /**
   * Backdrop to bake soft edges against, or undefined to leave them hard.
   *
   * NewIcons transparency is 1-bit, so a silhouette cannot carry the anti-aliasing the
   * source SVG has — which is what leaves converted icons stair-stepped. Compositing
   * the fringe against the colour the icon will sit on recovers it, at the price of
   * assuming that colour: on any other backdrop the baked pixels read as a fringe.
   * AmigaOS's own GlowIcons make exactly this trade, carrying an opaque grey shadow
   * that only resolves against the standard Workbench grey.
   */
  backgroundColor?: [number, number, number];
  /**
   * The colour the `glowSurround` selected state draws its halo in.
   *
   * Undefined keeps the original behaviour — the brightest entry the icon's own palette
   * happens to hold, which is near enough white for most artwork and was the only glow
   * available before this was configurable. Setting it costs one palette slot, because a
   * colour the icon does not contain cannot otherwise be drawn; see `prepareIcon`.
   */
  glowColor?: [number, number, number];
}

export async function decodeThemeIcon(zip: JSZip, icon: IconVariant, outputSizePx: number): Promise<RgbaImage> {
  const file = zip.file(icon.zipPath);
  if (!file) throw new Error(`Icon file missing from zip: ${icon.zipPath}`);

  if (icon.format === 'svg') {
    const svgText = await file.async('string');
    return rasterizeSvg(svgText, outputSizePx);
  }
  const bytes = await file.async('uint8array');
  return decodePng(bytes, outputSizePx);
}

export interface PreparedIcon {
  palette: [number, number, number][];
  normal: number[];
  selected: number[];
  width: number;
  height: number;
}

/**
 * Turns one decoded image into everything an `.info` needs: a palette and both states.
 *
 * This is the single place the whole per-icon pipeline lives, and that is deliberate.
 * Conversion and preview have to agree pixel for pixel — it is the constraint the
 * "preview / conversion pixel identity" test pins — and they used to agree only by
 * both remembering to perform the same steps in the same order against a palette
 * passed in from outside. Owning flattening, palette choice and mapping together
 * means the two callers cannot drift, because neither one makes those decisions.
 *
 * The palette is built from this icon alone. A NewIcons `.info` carries its own
 * palette, so sharing one across the batch was our choice rather than the format's,
 * and a costly one: the ceiling is 34 entries for the *entire* selection, which left
 * gradient-heavy icons working from about a dozen colours. Per icon they get the
 * full 34 — measured on a 36-icon batch, `preferences-desktop-gaming` went from 23
 * colours to 33, `music` and `folder-music` from 17 and 16 to 33 each.
 */
export function prepareIcon(decoded: RgbaImage, config: JobConfig): PreparedIcon {
  const image = config.backgroundColor
    ? flattenOntoBackground(decoded, config.backgroundColor)
    : decoded;

  /*
   * A chosen glow colour has to be *in* the palette, or it cannot be drawn at all: both
   * states of an .info share one palette, and the median cut only ever produces colours
   * the icon already contains — so a green halo on a red icon would snap to red. One slot
   * is taken off the quantizer's budget and the picked colour appended verbatim, keeping
   * the total inside the same ceiling. The cost is one colour of an already scarce 34,
   * which is why nothing is reserved unless the glow is both selected and configured.
   */
  const reservesGlowSlot = config.selectedEffect === 'glowSurround' && config.glowColor !== undefined;
  const cap = Math.min(config.maxColors, maxColorsForSingleLine());
  const palette = buildSharedPalette([image], reservesGlowSlot ? Math.max(cap - 1, 1) : cap);
  if (config.glowColor && reservesGlowSlot) palette.push(config.glowColor);

  const normal = mapImageToPalette(image, palette);
  const selected = applySelectedStateEffect(
    config.selectedEffect,
    palette,
    normal,
    image.width,
    image.height,
    config.tintColor,
    config.glowColor,
  );
  return { palette, normal, selected, width: image.width, height: image.height };
}

export async function runConversionJob(
  zip: JSZip,
  inputs: JobIconInput[],
  config: JobConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const decoded: Array<{ input: JobIconInput; image: RgbaImage }> = [];

  let attempted = 0;
  for (const input of inputs) {
    attempted++;
    try {
      let image = await decodeThemeIcon(zip, input.icon, config.outputSizePx);
      if (input.badge) {
        image = await compositeBadge(image, input.badge);
      }
      decoded.push({ input, image });
    } catch (error) {
      console.warn(`Skipping icon "${input.icon.name}": ${(error as Error).message}`);
    } finally {
      onProgress?.(attempted, inputs.length);
    }
  }

  const convertedIcons: ConvertedIcon[] = decoded.map(({ input, image }) => {
    const { palette, normal, selected, width, height } = prepareIcon(image, config);

    const infoBytes = buildInfoFile({
      width,
      height,
      kind: input.kind,
      normal: { width, height, transparent: true, palette, pixels: normal },
      selected: { width, height, transparent: true, palette, pixels: selected },
    });

    return { name: input.icon.name, infoBytes, role: input.role };
  });

  return buildOutputZip(convertedIcons);
}

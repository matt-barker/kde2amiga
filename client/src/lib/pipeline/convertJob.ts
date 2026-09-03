import type JSZip from 'jszip';
import type { IconVariant } from '../theme/themeParser';
import { rasterizeSvg, decodePng } from '../image/decode';
import { compositeBadge, type BadgeOptions } from '../badges/compositeBadge';
import { buildSharedPalette, mapImageToPalette, type RgbaImage } from '../image/quantize';
import { maxColorsForSingleLine } from '../newicons/paletteLimits';
import { flattenOntoBackground } from '../image/flatten';
import {
  applySelectedStateEffect,
  glowRadiusFor,
  glowRamp,
  type SelectedStateEffect,
} from '../image/selectedState';
import { buildInfoFile, type IconKind } from '../newicons/diskObject';
import type { ConvertedIcon } from '../output/outputEntries';

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
   * Undefined draws GlowIcons' own ramp — white, bright yellow, pale gold — so the
   * default matches AmigaOS. Setting it keeps the chosen colour as the middle stop and
   * derives the other two around it. Either way the halo costs three palette slots,
   * because colours the icon does not contain cannot otherwise be drawn; see
   * `prepareIcon` and `glowRamp`.
   */
  glowColor?: [number, number, number];
}

/**
 * What a fresh conversion starts from.
 *
 * Lives beside `JobConfig` rather than in the component that first renders it: it is a
 * property of the config shape, and exporting a constant from a component file is what
 * breaks React Fast Refresh.
 */
export const DEFAULT_JOB_CONFIG: JobConfig = {
  /*
   * GlowIcons' halo was measured at 4px inside a ~46px box, and `glowRadiusFor(48)` is 4
   * — so 48 is the size at which Glow Surround output matches AmigaOS ring for ring.
   * Below it the ramp truncates from the outside in.
   */
  outputSizePx: 48,
  maxColors: 16,
  selectedEffect: 'invert',
  // The standard Workbench grey. Smoothing edges against it is on by default because
  // it is what the OS's own GlowIcons assume; it can be switched off for other backdrops.
  backgroundColor: [0xab, 0xab, 0xab],
};

/**
 * Clear margin to hold back from the artwork so the selected state's halo has room.
 *
 * Both the conversion and the preview derive their margin here rather than each working
 * it out. They already have to agree pixel for pixel — that is what the preview/conversion
 * identity test pins — and a margin the two computed separately is exactly the kind of
 * step that drifts.
 */
export function glowMarginPx(config: JobConfig): number {
  // Every other effect recolours pixels where they already are, so taking room from the
  // artwork would shrink icons to no purpose.
  return config.selectedEffect === 'glowSurround' ? glowRadiusFor(config.outputSizePx) : 0;
}

export async function decodeThemeIcon(
  zip: JSZip,
  icon: IconVariant,
  outputSizePx: number,
  insetPx = 0,
): Promise<RgbaImage> {
  const file = zip.file(icon.zipPath);
  if (!file) throw new Error(`Icon file missing from zip: ${icon.zipPath}`);

  if (icon.format === 'svg') {
    const svgText = await file.async('string');
    return rasterizeSvg(svgText, outputSizePx, insetPx);
  }
  const bytes = await file.async('uint8array');
  return decodePng(bytes, outputSizePx, insetPx);
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
   * The halo's colours have to be *in* the palette, or they cannot be drawn at all: both
   * states of an .info share one palette, and the median cut only ever produces colours
   * the icon already contains — so a yellow halo on a red icon would snap to red. The
   * ramp's three stops come off the quantizer's budget and are appended verbatim, keeping
   * the total inside the same ceiling. Three of an already scarce 34 is a real cost, which
   * is why nothing is reserved unless this effect is the one selected.
   */
  const glowStops = config.selectedEffect === 'glowSurround' ? glowRamp(config.glowColor) : [];
  const cap = Math.min(config.maxColors, maxColorsForSingleLine());
  const palette = buildSharedPalette([image], Math.max(cap - glowStops.length, 1));
  palette.push(...glowStops);

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

/**
 * Converts the selected icons, and stops there.
 *
 * It deliberately returns icons rather than an archive: conversion is the slow half —
 * rasterising, quantising and encoding every icon — while packing is cheap, and the UI
 * offers both a zip and an LHA of the same run. Returning a single format here would
 * mean either converting twice or picking the format before the user does.
 */
export async function runConversionJob(
  zip: JSZip,
  inputs: JobIconInput[],
  config: JobConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<ConvertedIcon[]> {
  const decoded: Array<{ input: JobIconInput; image: RgbaImage }> = [];

  let attempted = 0;
  for (const input of inputs) {
    attempted++;
    try {
      let image = await decodeThemeIcon(zip, input.icon, config.outputSizePx, glowMarginPx(config));
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

  return convertedIcons;
}

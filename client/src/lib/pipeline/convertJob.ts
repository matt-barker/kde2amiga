import type JSZip from 'jszip';
import type { IconVariant } from '../theme/themeParser';
import { rasterizeSvg, decodePng } from '../image/decode';
import { compositeBadge, type BadgeOptions } from '../badges/compositeBadge';
import { buildSharedPalette, mapImageToPalette, type RgbaImage } from '../image/quantize';
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
}

async function decodeThemeIcon(zip: JSZip, icon: IconVariant, outputSizePx: number): Promise<RgbaImage> {
  const file = zip.file(icon.zipPath);
  if (!file) throw new Error(`Icon file missing from zip: ${icon.zipPath}`);

  if (icon.format === 'svg') {
    const svgText = await file.async('string');
    return rasterizeSvg(svgText, outputSizePx);
  }
  const bytes = await file.async('uint8array');
  return decodePng(bytes, outputSizePx);
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

  const palette = buildSharedPalette(decoded.map((d) => d.image), config.maxColors);

  const convertedIcons: ConvertedIcon[] = decoded.map(({ input, image }) => {
    const normalPixels = mapImageToPalette(image, palette);
    const selectedPixels = applySelectedStateEffect(
      config.selectedEffect,
      palette,
      normalPixels,
      image.width,
      image.height,
      config.tintColor,
    );

    const infoBytes = buildInfoFile({
      width: image.width,
      height: image.height,
      kind: input.kind,
      normal: { width: image.width, height: image.height, transparent: true, palette, pixels: normalPixels },
      selected: { width: image.width, height: image.height, transparent: true, palette, pixels: selectedPixels },
    });

    return { name: input.icon.name, infoBytes, role: input.role };
  });

  return buildOutputZip(convertedIcons);
}

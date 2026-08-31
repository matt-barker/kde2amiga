import { describe, it, expect } from 'vitest';
import { buildSharedPalette, mapImageToPalette, type RgbaImage } from './quantize';
import { maxColorsForSingleLine } from '../newicons/paletteLimits';

function solidImage(width: number, height: number, rgba: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
}

describe('buildSharedPalette', () => {
  it('always reserves index 0 for transparent/background black', () => {
    const palette = buildSharedPalette([solidImage(2, 2, [255, 0, 0, 255])], 8);
    expect(palette[0]).toEqual([0, 0, 0]);
  });

  it('never exceeds maxColors', () => {
    const images = [
      solidImage(2, 2, [255, 0, 0, 255]),
      solidImage(2, 2, [0, 255, 0, 255]),
      solidImage(2, 2, [0, 0, 255, 255]),
    ];
    const palette = buildSharedPalette(images, 2);
    expect(palette.length).toBeLessThanOrEqual(2);
  });

  it('never exceeds the single-line palette ceiling even when asked for far more', () => {
    const size = 16;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      data.set([i, (i * 7) % 256, (i * 13) % 256, 255], i * 4);
    }
    const palette = buildSharedPalette([{ width: size, height: size, data }], 1000);
    expect(palette.length).toBeLessThanOrEqual(maxColorsForSingleLine());
    expect(palette.length).toBe(maxColorsForSingleLine());
  });
});

describe('mapImageToPalette', () => {
  it('maps fully transparent pixels to index 0', () => {
    const image = solidImage(1, 1, [10, 20, 30, 0]);
    const palette: [number, number, number][] = [[0, 0, 0], [10, 20, 30]];
    expect(mapImageToPalette(image, palette)).toEqual([0]);
  });

  it('maps opaque pixels to their nearest palette color', () => {
    const image = solidImage(1, 1, [12, 18, 29, 255]);
    const palette: [number, number, number][] = [[0, 0, 0], [10, 20, 30], [200, 200, 200]];
    expect(mapImageToPalette(image, palette)).toEqual([1]);
  });
});

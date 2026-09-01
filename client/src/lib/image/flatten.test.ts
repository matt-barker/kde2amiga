import { describe, it, expect } from 'vitest';
import { flattenOntoBackground, MIN_FLATTENED_ALPHA } from './flatten';
import type { RgbaImage } from './quantize';

function pixels(list: [number, number, number, number][]): RgbaImage {
  const data = new Uint8ClampedArray(list.length * 4);
  list.forEach((p, i) => data.set(p, i * 4));
  return { width: list.length, height: 1, data };
}

const GREY: [number, number, number] = [0xab, 0xab, 0xab];
const at = (image: RgbaImage, i: number) =>
  [image.data[i * 4], image.data[i * 4 + 1], image.data[i * 4 + 2], image.data[i * 4 + 3]];

describe('flattenOntoBackground', () => {
  it('leaves a fully opaque pixel exactly as it was', () => {
    const out = flattenOntoBackground(pixels([[10, 20, 30, 255]]), GREY);
    expect(at(out, 0)).toEqual([10, 20, 30, 255]);
  });

  it('leaves a fully transparent pixel transparent', () => {
    const out = flattenOntoBackground(pixels([[10, 20, 30, 0]]), GREY);
    expect(at(out, 0)[3]).toBe(0);
  });

  it('blends a half-transparent pixel halfway toward the background', () => {
    // This is the whole point: 1-bit alpha cannot anti-alias a silhouette, so the
    // blend has to be baked in. GlowIcons does the same — its drop shadow is opaque
    // grey that only resolves against the Workbench grey it assumes.
    const out = flattenOntoBackground(pixels([[0, 0, 0, 128]]), GREY);
    const [r, g, b, a] = at(out, 0);
    expect(a).toBe(255);
    expect([r, g, b]).toEqual([85, 85, 85]); // 171 * (127/255)
  });

  it('makes a pixel at the threshold opaque rather than dropping it', () => {
    expect(at(flattenOntoBackground(pixels([[0, 0, 0, MIN_FLATTENED_ALPHA]]), GREY), 0)[3]).toBe(255);
  });

  it('drops a pixel fainter than the threshold', () => {
    // Without a floor the widest, faintest reaches of a drop shadow all become
    // opaque background-coloured pixels: invisible on grey, but a halo anywhere
    // else, and palette slots spent on shades of the backdrop.
    expect(at(flattenOntoBackground(pixels([[0, 0, 0, MIN_FLATTENED_ALPHA - 1]]), GREY), 0)[3]).toBe(0);
  });

  it('blends toward whatever background it is given, not a fixed grey', () => {
    const red: [number, number, number] = [200, 0, 0];
    const [r, g, b] = at(flattenOntoBackground(pixels([[0, 0, 0, 128]]), red), 0);
    expect([r, g, b]).toEqual([100, 0, 0]);
  });

  it('does not modify the image it is given', () => {
    const source = pixels([[0, 0, 0, 128]]);
    flattenOntoBackground(source, GREY);
    expect(at(source, 0)).toEqual([0, 0, 0, 128]);
  });
});

import { describe, it, expect } from 'vitest';
import { applySelectedStateEffect } from './selectedState';

const palette: [number, number, number][] = [
  [0, 0, 0],
  [255, 255, 255],
  [100, 100, 100],
];

describe('applySelectedStateEffect', () => {
  it('invert maps each color to its nearest match after RGB inversion', () => {
    // pixel using palette[1] = white (255,255,255) inverted -> black (0,0,0) -> nearest is palette[0]
    const result = applySelectedStateEffect('invert', palette, [1], 1, 1);
    expect(result).toEqual([0]);
  });

  it('brighten pushes colors toward white and re-snaps to the palette', () => {
    // black brightened by 60 -> (60,60,60), nearest palette entry is the mid-grey
    const result = applySelectedStateEffect('brighten', palette, [0], 1, 1);
    expect(result).toEqual([2]);
  });

  it('darken pushes colors toward black and re-snaps to the palette', () => {
    const result = applySelectedStateEffect('darken', palette, [2], 1, 1);
    expect(result).toEqual([0]);
  });

  it('tint blends toward the given tint color', () => {
    const result = applySelectedStateEffect('tint', palette, [1], 1, 1, [0, 0, 0]);
    // white tinted toward black should move away from index 1 (pure white)
    expect(result[0]).not.toBe(1);
  });

  it('glowSurround leaves interior pixels alone but does not throw on a 1x1 image', () => {
    const result = applySelectedStateEffect('glowSurround', palette, [1], 1, 1);
    expect(result.length).toBe(1);
  });
});

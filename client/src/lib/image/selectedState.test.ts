import { describe, it, expect } from 'vitest';
import { applySelectedStateEffect } from './selectedState';

const palette: [number, number, number][] = [
  [0, 0, 0],
  [255, 255, 255],
  [100, 100, 100],
];

describe('applySelectedStateEffect', () => {
  it('invert maps each color to its nearest match after RGB inversion, never onto index 0', () => {
    // pixel using palette[1] = white (255,255,255) inverted -> black (0,0,0). Nearest by
    // raw distance is palette[0] (0,0,0), but index 0 is the reserved transparent slot and
    // must never be reachable from a non-zero input index, so the nearest non-zero entry
    // wins instead: palette[2] = (100,100,100), distance 100^2*3=30000 vs palette[1]'s
    // 255^2*3=195075.
    const result = applySelectedStateEffect('invert', palette, [1], 1, 1);
    expect(result).toEqual([2]);
  });

  it('brighten pushes colors toward white and re-snaps to the palette', () => {
    // mid-grey (100,100,100) brightened by 60 -> (160,160,160), which is nearer
    // to (200,200,200) (distance 40^2*3=4800) than to (100,100,100) itself (60^2*3=10800)
    // or (0,0,0) (160^2*3=76800).
    const brightenPalette: [number, number, number][] = [
      [0, 0, 0],
      [100, 100, 100],
      [200, 200, 200],
    ];
    const result = applySelectedStateEffect('brighten', brightenPalette, [1], 1, 1);
    expect(result).toEqual([2]);
  });

  it('leaves index 0 unchanged under every effect', () => {
    for (const effect of ['invert', 'brighten', 'darken', 'tint', 'glowSurround'] as const) {
      const result = applySelectedStateEffect(effect, palette, [0], 1, 1, [255, 255, 0]);
      expect(result).toEqual([0]);
    }
  });

  it('darken pushes colors toward black and re-snaps to the palette, never landing on index 0', () => {
    // palette[2] = (100,100,100) darkened by 60 -> (40,40,40). Distances: to index 0
    // (0,0,0) is 40^2*3=4800 (excluded — reserved transparent slot); to index 2
    // (100,100,100) itself is 60^2*3=10800; to index 3 (30,30,30) is 10^2*3=300, the
    // nearest reachable entry.
    const darkenPalette: [number, number, number][] = [
      [0, 0, 0],
      [255, 255, 255],
      [100, 100, 100],
      [30, 30, 30],
    ];
    const result = applySelectedStateEffect('darken', darkenPalette, [2], 1, 1);
    expect(result).toEqual([3]);
  });

  it('never remaps a non-zero input index to index 0, for any effect', () => {
    const richPalette: [number, number, number][] = [
      [0, 0, 0],
      [255, 255, 255],
      [10, 10, 10],
      [245, 245, 245],
      [128, 128, 128],
    ];
    for (const effect of ['invert', 'brighten', 'darken', 'tint', 'glowSurround'] as const) {
      for (let index = 1; index < richPalette.length; index++) {
        const result = applySelectedStateEffect(effect, richPalette, [index], 1, 1, [0, 0, 0]);
        expect(result[0]).not.toBe(0);
      }
    }
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

  it('glowSurround grows only a 1px border, without cascading across the row', () => {
    // palette[1] (white) is the brightest entry; row is [foreground, background, background]
    const result = applySelectedStateEffect('glowSurround', palette, [1, 0, 0], 3, 1);
    expect(result).toEqual([1, 1, 0]);
  });
});

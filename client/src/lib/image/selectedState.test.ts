import { describe, it, expect } from 'vitest';
import { bayerFraction } from './dither';
import { applySelectedStateEffect, glowRadiusFor, glowRamp } from './selectedState';

const palette: [number, number, number][] = [
  [0, 0, 0],
  [255, 255, 255],
  [100, 100, 100],
];

describe('applySelectedStateEffect', () => {
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
    for (const effect of ['brighten', 'darken', 'tint', 'glowSurround'] as const) {
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
    for (const effect of ['brighten', 'darken', 'tint', 'glowSurround'] as const) {
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

describe('glowSurround with a chosen colour', () => {
  it('puts the chosen colour on the middle ring, with its derived stops either side', () => {
    // The chosen colour is the one the eye reads as "the glow", so it takes the middle
    // stop rather than the whole halo — the same place yellow sits in GlowIcons' ramp,
    // between a lighter core and a stop washed toward the Workbench grey.
    const size = 48;
    const greenPalette: [number, number, number][] = [
      [0, 0, 0],
      [200, 0, 0],
      [153, 204, 153],
      [0, 128, 0],
      [60, 143, 60],
    ];
    const pixels = new Array(size * size).fill(0);
    pixels[24 * size + 24] = 1;
    const result = applySelectedStateEffect(
      'glowSurround', greenPalette, pixels, size, size, undefined, [0, 128, 0],
    );
    expect([
      result[24 * size + 25],
      result[24 * size + 26],
      result[24 * size + 27],
    ]).toEqual([2, 3, 4]);
  });

  it('still uses the brightest entry when no glow colour is chosen', () => {
    const result = applySelectedStateEffect('glowSurround', palette, [1, 0, 0], 3, 1);
    expect(result).toEqual([1, 1, 0]);
  });

  it('never draws the glow in the reserved transparent slot, however dark the chosen colour', () => {
    // Black is exactly palette[0], but index 0 is the transparency hole: a glow that
    // landed there would be invisible rather than dark.
    const result = applySelectedStateEffect('glowSurround', palette, [1, 0, 0], 3, 1, undefined, [0, 0, 0]);
    expect(result[1]).not.toBe(0);
  });
});

describe('glowRadiusFor', () => {
  it('gives the halo its GlowIcons thickness at the 48px preset', () => {
    // Decoded from a Workbench 3.2.3 screenshot: GlowIcons draws 38x38 artwork inside a
    // ~46px gadget box, with exactly 4px of halo in the margin. 48 is the nearest preset,
    // so it is the size at which our output should match theirs ring for ring.
    expect(glowRadiusFor(48)).toBe(4);
  });

  it('keeps the halo proportional to the icon at every offered size', () => {
    // A fixed 4px would swamp a 24px icon and vanish on a 128px one. Holding the
    // 4/48 ratio keeps the glow reading the same relative to the artwork throughout.
    expect([24, 32, 48, 64, 128].map(glowRadiusFor)).toEqual([2, 3, 4, 5, 11]);
  });

  it('never rounds the halo away entirely', () => {
    expect(glowRadiusFor(4)).toBe(1);
    expect(glowRadiusFor(1)).toBe(1);
  });
});

describe('glowRamp', () => {
  it('reproduces the GlowIcons ramp verbatim when no colour is chosen', () => {
    // Sampled from the selected ReAction icon: white core, bright yellow, pale gold.
    expect(glowRamp()).toEqual([
      [255, 255, 255],
      [239, 231, 23],
      [223, 187, 71],
    ]);
  });

  it('derives a hot core and a faded outer stop from a chosen colour', () => {
    // The chosen colour stays the middle stop — the one the eye reads as "the glow" —
    // with a lightened core inside it and a stop faded toward the Workbench grey
    // outside, mirroring how the GlowIcons ramp is built around its yellow.
    expect(glowRamp([0, 128, 0])).toEqual([
      [153, 204, 153],
      [0, 128, 0],
      [60, 143, 60],
    ]);
  });
});

describe('glowSurround halo', () => {
  const SIZE = 48; // glowRadiusFor(48) === 4, GlowIcons' own halo thickness
  const haloPalette: [number, number, number][] = [
    [0, 0, 0], // 0: the reserved transparent slot
    [200, 0, 0], // 1: artwork
    [255, 255, 255], // 2: ramp core
    [239, 231, 23], // 3: ramp middle
    [223, 187, 71], // 4: ramp outer
  ];

  /** Two adjacent artwork pixels, so the outer ring covers both dither phases. */
  function haloAroundBar(): number[] {
    const pixels = new Array(SIZE * SIZE).fill(0);
    pixels[24 * SIZE + 23] = 1;
    pixels[24 * SIZE + 24] = 1;
    return applySelectedStateEffect('glowSurround', haloPalette, pixels, SIZE, SIZE);
  }

  const at = (result: number[], x: number, y: number) => result[y * SIZE + x];

  it('ramps white, then yellow, then gold outward from the artwork', () => {
    const result = haloAroundBar();
    expect([at(result, 25, 24), at(result, 26, 24), at(result, 27, 24)]).toEqual([2, 3, 4]);
  });

  it('leaves the artwork itself untouched', () => {
    expect(at(haloAroundBar(), 24, 24)).toBe(1);
  });

  it('draws nothing past the halo radius', () => {
    expect(at(haloAroundBar(), 29, 24)).toBe(0);
  });

  it('measures distance across edges, not corners, so a diagonal neighbour is one ring further out', () => {
    // GlowIcons' halo is a Manhattan distance transform: (25,25) is two steps from the
    // artwork at (24,24), not one, so it takes the yellow ring rather than the white core.
    expect(at(haloAroundBar(), 25, 25)).toBe(3);
  });

  it('fills a transparent gap enclosed by artwork', () => {
    // The halo is drawn behind the icon, so gaps between shapes glow too — visible in the
    // GlowIcons screenshot between ReAction's arrowheads.
    const pixels = new Array(SIZE * SIZE).fill(0);
    pixels[24 * SIZE + 23] = 1;
    pixels[24 * SIZE + 25] = 1;
    const result = applySelectedStateEffect('glowSurround', haloPalette, pixels, SIZE, SIZE);
    expect(at(result, 24, 24)).toBe(2);
  });

  it('masks the outermost ring with the shared dither cell', () => {
    // 1-bit transparency cannot fade, so GlowIcons buys a fifth level of falloff by
    // running the last ring at half coverage. Both phases have to actually occur here,
    // or the assertion would hold vacuously.
    const result = haloAroundBar();
    const painted: boolean[] = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const distance = Math.min(Math.abs(x - 23), Math.abs(x - 24)) + Math.abs(y - 24);
        if (distance !== 4) continue;
        const isPainted = at(result, x, y) !== 0;
        expect(isPainted).toBe(bayerFraction(x, y) < 0.5);
        painted.push(isPainted);
      }
    }
    expect(painted).toContain(true);
    expect(painted).toContain(false);
  });

  it('truncates the ramp rather than crowding it when the icon is small', () => {
    // glowRadiusFor(24) === 2: there is only room for the core and the middle stop, so
    // the gold is dropped instead of all three being squeezed into two rings.
    const small = 24;
    const pixels = new Array(small * small).fill(0);
    pixels[12 * small + 12] = 1;
    const result = applySelectedStateEffect('glowSurround', haloPalette, pixels, small, small);
    expect(result[12 * small + 13]).toBe(2);
    expect(result[12 * small + 14]).toBe(3);
    expect(result[12 * small + 15]).toBe(0);
  });
});

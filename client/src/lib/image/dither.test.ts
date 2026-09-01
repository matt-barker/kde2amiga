import { describe, it, expect } from 'vitest';
import { bayerFraction, buildDrawnMask, CELL } from './dither';
import type { RgbaImage } from './quantize';

/** An image whose every pixel carries the same alpha. */
function uniformAlpha(width: number, height: number, alpha: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([255, 0, 0, alpha], i * 4);
  return { width, height, data };
}

function drawnCount(mask: Uint8Array): number {
  return mask.reduce((n, drawn) => n + drawn, 0);
}

describe('buildDrawnMask', () => {
  it('never draws a fully transparent pixel', () => {
    expect(drawnCount(buildDrawnMask(uniformAlpha(8, 8, 0)))).toBe(0);
  });

  it('always draws a fully opaque pixel', () => {
    expect(drawnCount(buildDrawnMask(uniformAlpha(8, 8, 255)))).toBe(64);
  });

  it('resolves a region of uniform alpha the same way throughout', () => {
    // Dithering the alpha channel was tried and abandoned: it reached only the
    // one-pixel anti-aliasing fringe, about 2% of an icon, while perforating the
    // flat translucent fills these themes use for interior detail. Coverage is
    // decided by a plain cutoff; dithering earns its place on colour instead.
    for (const alpha of [40, 100, 127]) {
      expect(drawnCount(buildDrawnMask(uniformAlpha(8, 8, alpha)))).toBe(0);
    }
    for (const alpha of [128, 200, 255]) {
      expect(drawnCount(buildDrawnMask(uniformAlpha(8, 8, alpha)))).toBe(64);
    }
  });
});

describe('bayerFraction', () => {
  it('gives every cell position a distinct threshold strictly inside 0 and 1', () => {
    const seen = new Set<number>();
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const t = bayerFraction(x, y);
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThan(1);
        seen.add(t);
      }
    }
    expect(seen.size).toBe(CELL * CELL);
  });

  it('splits a cell evenly, so a half-way colour lands on each side equally', () => {
    let below = 0;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) if (bayerFraction(x, y) < 0.5) below++;
    expect(below).toBe((CELL * CELL) / 2);
  });

  it('alternates between neighbours rather than running low values together', () => {
    // A checkerboard is what makes a dithered region read as an even blend; a
    // matrix that grouped its low thresholds would give visible stripes instead.
    const highLow = [0, 1, 2, 3].map((x) => (bayerFraction(x, 0) < 0.5 ? 1 : 0));
    expect(highLow).toEqual([1, 0, 1, 0]);
  });

  it('repeats every cell, so the pattern tiles across an image', () => {
    expect(bayerFraction(CELL + 1, CELL + 2)).toBe(bayerFraction(1, 2));
  });
});

import { describe, it, expect } from 'vitest';
import { maxColorsForSingleLine, bitCountForColors } from './paletteLimits';

describe('maxColorsForSingleLine', () => {
  it('computes the largest palette that fits header+palette in one 123-byte line', () => {
    // (123 - 5) chars * 7 bits = 826 bits available for palette; 826 / 24 = 34.41
    expect(maxColorsForSingleLine()).toBe(34);
  });
});

describe('bitCountForColors', () => {
  it('returns the minimum bits needed to index colorCount colors', () => {
    expect(bitCountForColors(2)).toBe(1);
    expect(bitCountForColors(3)).toBe(2);
    expect(bitCountForColors(16)).toBe(4);
    expect(bitCountForColors(17)).toBe(5);
  });
});

import { describe, it, expect } from 'vitest';
import { huffmanCodeLengths, canonicalCodes } from './huffman';

/** Kraft sum: exactly 1 for a complete prefix code, over 1 for an impossible one. */
function kraft(lengths: number[]): number {
  return lengths.reduce((sum, len) => (len > 0 ? sum + 2 ** -len : sum), 0);
}

describe('huffmanCodeLengths', () => {
  it('assigns no length to symbols that never occur', () => {
    expect(huffmanCodeLengths([0, 5, 0, 3], 16)).toEqual([0, expect.any(Number), 0, expect.any(Number)]);
  });

  it('gives a lone symbol a one-bit code', () => {
    // Lhasa's build_tree places a single code at depth 1; a zero-length code is only
    // reachable through the table's "single code" special form, which we do not use.
    expect(huffmanCodeLengths([0, 7, 0], 16)).toEqual([0, 1, 0]);
  });

  it('gives two equally frequent symbols one bit each', () => {
    expect(huffmanCodeLengths([4, 4], 16)).toEqual([1, 1]);
  });

  it('never gives a more frequent symbol a longer code', () => {
    const freqs = [1, 2, 3, 5, 8, 13, 21, 34];
    const lengths = huffmanCodeLengths(freqs, 16);
    for (let a = 0; a < freqs.length; a++) {
      for (let b = 0; b < freqs.length; b++) {
        if (freqs[a] > freqs[b]) expect(lengths[a]).toBeLessThanOrEqual(lengths[b]);
      }
    }
  });

  it('produces a complete prefix code', () => {
    const lengths = huffmanCodeLengths([1, 1, 2, 3, 5, 8, 13, 21, 34, 55], 16);
    expect(kraft(lengths)).toBeCloseTo(1, 10);
  });

  it('respects the maximum length even on a pathological distribution', () => {
    // Fibonacci frequencies are the worst case: they drive an unconstrained Huffman
    // tree to one code per level. Unclamped this reaches ~28 bits.
    const freqs = [1, 1];
    for (let i = 2; i < 30; i++) freqs.push(freqs[i - 1] + freqs[i - 2]);
    const lengths = huffmanCodeLengths(freqs, 16);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(16);
    expect(kraft(lengths)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('returns all zero lengths when nothing occurs at all', () => {
    expect(huffmanCodeLengths([0, 0, 0], 16)).toEqual([0, 0, 0]);
  });
});

describe('canonicalCodes', () => {
  it('assigns zero to the only one-bit symbol', () => {
    expect(canonicalCodes([1, 0])).toEqual([0, 0]);
  });

  it('numbers equal-length symbols upward in symbol order', () => {
    // Lhasa's add_codes_with_length walks symbols ascending at each depth, so the
    // lowest-indexed symbol at a given length takes the lowest code.
    expect(canonicalCodes([2, 2, 2, 2])).toEqual([0b00, 0b01, 0b10, 0b11]);
  });

  it('shifts left when moving to the next length', () => {
    // Lengths 1,2,3,3: codes 0 / 10 / 110 / 111.
    expect(canonicalCodes([1, 2, 3, 3])).toEqual([0b0, 0b10, 0b110, 0b111]);
  });

  it('skips unused symbols without consuming a code', () => {
    expect(canonicalCodes([2, 0, 2, 2])).toEqual([0b00, 0, 0b01, 0b10]);
  });
});

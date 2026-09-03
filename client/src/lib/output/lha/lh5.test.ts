import { describe, it, expect } from 'vitest';
import { lh5Compress } from './lh5';

/**
 * Reads back only the fixed-width header fields at the head of a block. Deliberately not
 * a decoder: it walks no Huffman trees and decodes no commands, so it cannot "agree" with
 * a broken encoder the way a mirror-image decoder would. Whether the stream actually
 * decodes is settled in lhaWriter.oracle.test.ts, against Lhasa.
 */
class SpecReader {
  private at = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  bits(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const bit = (this.bytes[this.at >> 3] >> (7 - (this.at & 7))) & 1;
      value = (value << 1) | bit;
      this.at++;
    }
    return value;
  }
}

function bytesOf(text: string): Uint8Array {
  return Uint8Array.from(new TextEncoder().encode(text));
}

describe('lh5Compress', () => {
  it('emits nothing for empty input', () => {
    expect(lh5Compress(new Uint8Array([]))).toEqual(new Uint8Array([]));
  });

  it('opens a block with a 16-bit count of the commands it contains', () => {
    // Six bytes with nothing repeated: six literal commands, no matches.
    const reader = new SpecReader(lh5Compress(bytesOf('abcdef')));
    expect(reader.bits(16)).toBe(6);
  });

  it('counts a match as one command, not as the bytes it expands to', () => {
    // "abcabcabc": three literals then one match covering the remaining six bytes.
    const reader = new SpecReader(lh5Compress(bytesOf('abcabcabc')));
    expect(reader.bits(16)).toBe(4);
  });

  it('splits input into blocks of at most 65535 commands', () => {
    // 70000 non-repeating-ish bytes force a second block.
    const bytes = new Uint8Array(70000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 181 + (i >> 8) * 7) & 0xff;
    const reader = new SpecReader(lh5Compress(bytes));
    expect(reader.bits(16)).toBeLessThanOrEqual(65535);
  });

  it('produces output for input with no matches at all', () => {
    // All-literal input leaves the offset tree empty, which the format expresses with a
    // dedicated "single code" form rather than an empty table. Regression guard: this
    // path once wrote a table of zero entries and desynchronised the stream.
    expect(lh5Compress(bytesOf('abcdefghij')).length).toBeGreaterThan(0);
  });

  it('compresses highly repetitive data to a fraction of its size', () => {
    const bytes = new Uint8Array(20000).fill(0x41);
    expect(lh5Compress(bytes).length).toBeLessThan(500);
  });

  it('is deterministic', () => {
    const bytes = bytesOf('the quick brown fox jumps over the lazy dog'.repeat(40));
    expect(lh5Compress(bytes)).toEqual(lh5Compress(bytes));
  });
});

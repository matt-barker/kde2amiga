import { describe, it, expect } from 'vitest';
import {
  lzssCompress,
  LH5_WINDOW,
  LH5_MAX_MATCH,
  type LzToken,
} from './lzss';

/**
 * Replays a token stream the way any LZ77 decoder does, byte at a time so that an
 * overlapping match (distance < length) extends as it copies.
 *
 * This is a test helper, not a second implementation to trust: it only pins that the
 * match finder is self-consistent. Whether the *format* is right is settled in
 * lhaWriter.oracle.test.ts against Lhasa, because a matched pair of wrong encoder and
 * wrong decoder is exactly how our NewIcons encoder once passed 63 tests while broken.
 */
/**
 * jsdom's `TextEncoder` builds its Uint8Array in a different realm from the test's, so
 * `toEqual` compares prototypes and fails on byte-identical data. Re-wrapping keeps the
 * comparison honest — it must catch a real byte difference, not a realm difference.
 */
function bytesOf(text: string): Uint8Array {
  return Uint8Array.from(new TextEncoder().encode(text));
}

function replay(tokens: LzToken[]): Uint8Array {
  const out: number[] = [];
  for (const token of tokens) {
    if (token.kind === 'literal') {
      out.push(token.byte);
      continue;
    }
    const start = out.length - token.distance;
    for (let i = 0; i < token.length; i++) out.push(out[start + i]);
  }
  return Uint8Array.from(out);
}

describe('lzssCompress', () => {
  it('emits nothing for empty input', () => {
    expect(lzssCompress(new Uint8Array([]))).toEqual([]);
  });

  it('emits literals when nothing repeats', () => {
    const tokens = lzssCompress(bytesOf('abcdef'));
    expect(tokens.every((t) => t.kind === 'literal')).toBe(true);
    expect(tokens).toHaveLength(6);
  });

  it('emits a match for a repeated run', () => {
    const tokens = lzssCompress(bytesOf('abcabcabc'));
    expect(tokens.some((t) => t.kind === 'match')).toBe(true);
  });

  it('leaves runs shorter than the three-byte minimum as literals', () => {
    // "ab" recurs, but a two-byte match costs more to encode than two literals.
    const tokens = lzssCompress(bytesOf('abxxxxxxxxab'));
    const matches = tokens.filter((t): t is Extract<LzToken, { kind: 'match' }> => t.kind === 'match');
    expect(matches.every((m) => m.length >= 3)).toBe(true);
  });

  it('never emits a match longer than the format allows', () => {
    const tokens = lzssCompress(new Uint8Array(5000).fill(0x41));
    for (const token of tokens) {
      if (token.kind === 'match') expect(token.length).toBeLessThanOrEqual(LH5_MAX_MATCH);
    }
  });

  it('never emits a distance beyond the 8KB window', () => {
    const bytes = new Uint8Array(40000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff;
    const tokens = lzssCompress(bytes);
    for (const token of tokens) {
      if (token.kind === 'match') expect(token.distance).toBeLessThanOrEqual(LH5_WINDOW);
    }
  });

  it('uses an overlapping match to encode a long run of one byte', () => {
    const tokens = lzssCompress(new Uint8Array(600).fill(0x5a));
    const matches = tokens.filter((t): t is Extract<LzToken, { kind: 'match' }> => t.kind === 'match');
    expect(matches.some((m) => m.distance < m.length)).toBe(true);
  });

  it('round-trips arbitrary bytes back to the original', () => {
    const bytes = new Uint8Array(20000);
    let seed = 12345;
    for (let i = 0; i < bytes.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      // Deliberately repetitive: pure noise would exercise only the literal path.
      bytes[i] = i % 3 === 0 ? (seed >>> 16) & 0xff : 0x20;
    }
    expect(replay(lzssCompress(bytes))).toEqual(bytes);
  });

  it('round-trips real NewIcons-shaped data', () => {
    const text = 'IM1=' + 'ABCDEFGH'.repeat(500) + 'IM2=' + 'ABCDEFGH'.repeat(500);
    const bytes = bytesOf(text);
    expect(replay(lzssCompress(bytes))).toEqual(bytes);
  });
});

/**
 * `-lh5-`'s dictionary is 8 KiB. A distance beyond it encodes to a 14-bit offset that a
 * strict decoder cannot resolve, because it only keeps 8192 bytes of history.
 *
 * This is not theoretical. An encoder that allowed 16 KiB produced an archive Lhasa
 * decoded perfectly and both Amiga LhA 2.15 and 7-Zip refused: 7-Zip wrote 8598 bytes of
 * a 109956-byte file and stopped at the first over-long back-reference. Every file in the
 * archive under 8 KiB was fine, which is exactly why the oracle tests missed it — they
 * decode through Lhasa, which tolerates the over-long distance.
 */
describe('the -lh5- window bound', () => {
  it('never emits a distance beyond the 8 KiB dictionary', () => {
    // A run far enough back that an unbounded matcher would reach for it: 12000 bytes of
    // non-repeating filler, then a verbatim repeat of the opening bytes.
    const head = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 0xff);
    const input = new Uint8Array(12000 + head.length);
    for (let i = 0; i < 12000; i++) input[i] = (i * 2654435761) >>> 24;
    input.set(head, 0);
    input.set(head, 12000);

    const tokens = lzssCompress(input);
    const distances = tokens.flatMap((t) => (t.kind === 'match' ? [t.distance] : []));

    expect(distances.length).toBeGreaterThan(0); // the assertion below is not vacuous
    expect(Math.max(...distances)).toBeLessThanOrEqual(LH5_WINDOW);
    expect(LH5_WINDOW).toBe(8192);
  });
});

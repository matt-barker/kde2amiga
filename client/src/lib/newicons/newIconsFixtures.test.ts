import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeInfoFileForTest, decodeBitsForTest } from './diskObjectDecoderForTest';

// Held in a variable: `new URL(..., import.meta.url)` written literally is rewritten by
// Vite into an asset URL, which breaks the lookup under vitest.
const moduleUrl = import.meta.url;

/**
 * These are real NewIcons files written by real Amiga software, vendored from
 * steffest/Amiga-Icon-converter (MIT). See __fixtures__/README.md.
 *
 * They are the external oracle for the format: our own encoder and decoder used to share
 * the same two misreadings, so a round-trip through our own code proved nothing.
 */
function loadFixture(name: string): Uint8Array {
  const path = fileURLToPath(new URL(`./__fixtures__/${name}`, moduleUrl));
  return new Uint8Array(readFileSync(path));
}

function headerBytes(line: string): number[] {
  return [0, 1, 2, 3, 4].map((i) => line.charCodeAt(i));
}

describe('real NewIcons fixtures', () => {
  it('decodes Apps.info as a transparent 36x40 icon with an 8-colour IM1 palette', () => {
    const icon = decodeInfoFileForTest(loadFixture('Apps.info'));

    expect(icon.magic).toBe(0xe310);
    expect(icon.type).toBe(2); // drawer

    // The five header characters are RAW: byte 0 is 'B' (66), not the 7-bit-encoded 'b' (98).
    expect(headerBytes(icon.im1Lines[0])).toEqual([66, 69, 73, 33, 41]);
    expect(icon.im1Lines[0].slice(0, 5)).toBe('BEI!)');

    expect(icon.normal.transparent).toBe(true);
    expect(icon.normal.width).toBe(36);
    expect(icon.normal.height).toBe(40);
    expect(icon.normal.colorCount).toBe(8);
    expect(icon.normal.bitCount).toBe(3);
    expect(icon.normal.palette).toHaveLength(8);
    expect(icon.normal.palette[0]).toEqual([165, 168, 168]);
    expect(icon.normal.palette[7]).toEqual([255, 255, 255]);
    // Guards the per-line floor, not just the post-trim length: continuous-stream decoding
    // would yield 1444 raw pixels here (wrong), not 1443.
    expect(icon.normal.decodedPixelCount).toBe(1443);
    expect(icon.normal.pixels).toHaveLength(36 * 40);
    for (const p of icon.normal.pixels) expect(p).toBeLessThan(8);

    // The selected state carries its own palette and colour count.
    expect(headerBytes(icon.im2Lines[0])).toEqual([66, 69, 73, 33, 42]);
    expect(icon.selected.width).toBe(36);
    expect(icon.selected.height).toBe(40);
    expect(icon.selected.colorCount).toBe(9);
    expect(icon.selected.bitCount).toBe(4);
    expect(icon.selected.pixels).toHaveLength(36 * 40);
  });

  it('decodes 0016.info as a transparent 42x42 icon with a 32-colour palette', () => {
    const icon = decodeInfoFileForTest(loadFixture('0016.info'));

    expect(icon.magic).toBe(0xe310);
    expect(icon.type).toBe(4); // project
    expect(headerBytes(icon.im1Lines[0])).toEqual([66, 75, 75, 33, 65]);
    expect(icon.im1Lines[0].slice(0, 5)).toBe('BKK!A');

    expect(icon.normal.transparent).toBe(true);
    expect(icon.normal.width).toBe(42);
    expect(icon.normal.height).toBe(42);
    expect(icon.normal.colorCount).toBe(32);
    expect(icon.normal.bitCount).toBe(5);
    expect(icon.normal.palette).toHaveLength(32);
    expect(icon.normal.palette[0]).toEqual([149, 149, 149]);
    expect(icon.normal.palette[31]).toEqual([17, 17, 17]);
    // Guards the per-line floor, not just the post-trim length: continuous-stream decoding
    // would yield 1765 raw pixels here (wrong), not 1764.
    expect(icon.normal.decodedPixelCount).toBe(1764);
    expect(icon.normal.pixels).toHaveLength(42 * 42);

    expect(icon.selected.width).toBe(42);
    expect(icon.selected.height).toBe(42);
    expect(icon.selected.colorCount).toBe(32);
    expect(icon.selected.pixels).toHaveLength(42 * 42);
  });

  it('proves pixel lines are independent streams, not one continuous stream', () => {
    // 0016.info's IM1 pixel lines leave 3,1,2,1,0,0 spare bits. Flooring per line gives
    // exactly 1764 = 42*42 pixels; concatenating the lines first gives 1765 and every line
    // after the first is bit-shifted. This is the whole reason for Defect 2.
    const icon = decodeInfoFileForTest(loadFixture('0016.info'));
    const bitCount = icon.normal.bitCount;
    const lineBitLengths = icon.im1Lines.slice(1).map((l) => decodeBitsForTest(l).length);

    expect(lineBitLengths.map((n) => n % bitCount)).toEqual([3, 1, 2, 1, 0, 0]);

    const perLine = lineBitLengths.reduce((sum, n) => sum + Math.floor(n / bitCount), 0);
    expect(perLine).toBe(42 * 42);

    const continuous = lineBitLengths.reduce((sum, n) => sum + n, 0);
    expect(Math.floor(continuous / bitCount)).toBe(1765); // wrong by one, and misaligned
  });

  it('decodes the RLE (byte > 208) branch that Apps.info actually uses', () => {
    // Apps.info's IM1 palette is 27 encoded characters but expands to 224 bits (32 groups),
    // which is only possible via the reference's zero-fill RLE escape.
    const icon = decodeInfoFileForTest(loadFixture('Apps.info'));
    const palettePayload = icon.im1Lines[0].slice(5);
    expect(palettePayload.length).toBe(27);
    expect(decodeBitsForTest(palettePayload).length).toBe(224);
    expect(palettePayload.split('').some((c) => c.charCodeAt(0) > 208)).toBe(true);
  });
});

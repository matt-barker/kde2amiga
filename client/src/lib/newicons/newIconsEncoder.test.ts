import { describe, it, expect } from 'vitest';
import { encodeNewIconState } from './newIconsEncoder';
import { decodeSevenBitGroupsForTest } from './sevenBitCodec';
import { MAX_LINE_PAYLOAD_BYTES, bitCountForColors } from './paletteLimits';

describe('encodeNewIconState', () => {
  it('produces IM1= lines each no longer than 127 characters', () => {
    const width = 8;
    const height = 8;
    const palette: [number, number, number][] = [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [0, 255, 0],
    ];
    const pixels = new Array(width * height).fill(0).map((_, i) => i % palette.length);
    const lines = encodeNewIconState({ width, height, transparent: true, palette, pixels }, 'IM1=');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(127);
      expect(line.startsWith('IM1=')).toBe(true);
    }
  });

  it('writes the 5 header characters as raw literal bytes, not 7-bit encoded', () => {
    const palette: [number, number, number][] = [
      [10, 20, 30],
      [200, 210, 220],
    ];
    const pixels = [0, 1, 1, 0];
    const lines = encodeNewIconState(
      { width: 2, height: 2, transparent: true, palette, pixels },
      'IM1=',
    );
    const header = lines[0].slice(4, 9); // strip "IM1=", take the 5 header chars

    // Read exactly the way the reference decoder does: straight off the payload.
    expect(header.charCodeAt(0)).toBe(66); // 'B' -> transparent
    expect(header.charCodeAt(1) - 33).toBe(2); // width
    expect(header.charCodeAt(2) - 33).toBe(2); // height
    expect(((header.charCodeAt(3) - 33) << 6) + header.charCodeAt(4) - 33).toBe(2); // colorCount
    expect(header).toBe('B##!#'); // 'B', 2+33, 2+33, 0+33, 2+33

    // The old (broken) encoder pushed the header through encodeSevenBitGroups, which
    // would have written 98 ('b') here. Guard against a regression to that.
    expect(header.charCodeAt(0)).not.toBe(98);
    expect(decodeSevenBitGroupsForTest(header)[0]).not.toBe(66);
  });

  it("writes 'N' (78) in the header when the icon is not transparent", () => {
    const lines = encodeNewIconState(
      {
        width: 2,
        height: 2,
        transparent: false,
        palette: [
          [0, 0, 0],
          [1, 2, 3],
        ],
        pixels: [0, 1, 1, 0],
      },
      'IM2=',
    );
    expect(lines[0].charCodeAt(4)).toBe(78); // 'N'
  });

  it('7-bit-encodes the palette starting immediately after the raw header', () => {
    const palette: [number, number, number][] = [
      [10, 20, 30],
      [200, 210, 220],
    ];
    const lines = encodeNewIconState(
      { width: 2, height: 2, transparent: true, palette, pixels: [0, 1, 1, 0] },
      'IM1=',
    );
    const paletteChars = lines[0].slice(9);
    // 2 entries * 24 bits = 48 bits -> ceil(48/7) = 7 characters
    expect(paletteChars).toHaveLength(7);
    const bits = decodeSevenBitGroupsForTest(paletteChars)
      .map((g) => g.toString(2).padStart(7, '0'))
      .join('');
    expect(parseInt(bits.slice(0, 8), 2)).toBe(10);
    expect(parseInt(bits.slice(8, 16), 2)).toBe(20);
    expect(parseInt(bits.slice(16, 24), 2)).toBe(30);
    expect(parseInt(bits.slice(24, 32), 2)).toBe(200);
    expect(parseInt(bits.slice(32, 40), 2)).toBe(210);
    expect(parseInt(bits.slice(40, 48), 2)).toBe(220);
  });

  it('packs pixels per line at a pixel boundary, so each line stands alone', () => {
    // 34 colours -> 6 bits/pixel. A 123-character line holds 861 bits = 143.5 pixels, so a
    // continuous stream sliced into 123-character chunks would misalign every line after
    // the first by 3 bits. Per-line packing must emit whole pixels only.
    const palette: [number, number, number][] = Array.from({ length: 34 }, (_, i) => [i, i, i]);
    const bitCount = bitCountForColors(palette.length);
    expect(bitCount).toBe(6);

    const pixelsPerLine = Math.floor((MAX_LINE_PAYLOAD_BYTES * 7) / bitCount);
    expect(pixelsPerLine).toBe(143);

    const total = 400;
    const pixels = new Array(total).fill(0).map((_, i) => i % palette.length);
    const lines = encodeNewIconState(
      { width: 20, height: 20, transparent: true, palette, pixels },
      'IM1=',
    );

    // 400 pixels / 143 per line = 3 pixel lines, plus the header/palette line.
    expect(lines).toHaveLength(4);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(127);

    // Each pixel line decodes on its own to exactly the pixels it was given.
    let offset = 0;
    for (const line of lines.slice(1)) {
      const bits = decodeSevenBitGroupsForTest(line.slice(4))
        .map((g) => g.toString(2).padStart(7, '0'))
        .join('');
      const count = Math.floor(bits.length / bitCount);
      const expected = pixels.slice(offset, offset + pixelsPerLine);
      const decoded: number[] = [];
      for (let i = 0; i < count; i++) {
        decoded.push(parseInt(bits.slice(i * bitCount, i * bitCount + bitCount), 2));
      }
      // The trailing partial group is zero padding, so only compare the real pixels.
      expect(decoded.slice(0, expected.length)).toEqual(expected);
      offset += expected.length;
    }
    expect(offset).toBe(total);
  });

  it('keeps the first line within 127 characters at the 34-colour cap', () => {
    // 4 (prefix) + 5 (raw header) + ceil(34*24/7) = 4 + 5 + 117 = 126.
    const palette: [number, number, number][] = Array.from({ length: 34 }, (_, i) => [i, i, i]);
    const lines = encodeNewIconState(
      { width: 4, height: 4, transparent: true, palette, pixels: new Array(16).fill(0) },
      'IM1=',
    );
    expect(lines[0]).toHaveLength(126);
  });
});

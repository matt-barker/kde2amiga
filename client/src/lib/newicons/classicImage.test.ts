import { describe, it, expect } from 'vitest';
import { packClassicImageBitplane } from './classicImage';

describe('packClassicImageBitplane', () => {
  it('produces rows padded to a 16-pixel (2-byte) boundary', () => {
    const bytes = packClassicImageBitplane(8, 4, false);
    // width 8 -> rounded up to 16 -> 2 bytes/row; height 4 -> 8 bytes total
    expect(bytes.length).toBe(8);
  });

  it('draws a filled border: top row is all 1 bits within the width', () => {
    const bytes = packClassicImageBitplane(8, 4, false);
    // first row, first byte: top-left 8 pixels should all be set (border)
    expect(bytes[0]).toBe(0b11111111);
  });

  it('inverts the pattern when selected is true', () => {
    const normal = packClassicImageBitplane(8, 4, false);
    const selected = packClassicImageBitplane(8, 4, true);
    expect(selected[0]).toBe((~normal[0]) & 0xff);
  });
});

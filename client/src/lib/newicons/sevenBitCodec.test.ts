import { describe, it, expect } from 'vitest';
import { BitWriter, encodeSevenBitGroups, decodeSevenBitGroupsForTest } from './sevenBitCodec';

describe('BitWriter', () => {
  it('packs pushed bits into 7-bit groups, zero-padding the last group', () => {
    const w = new BitWriter();
    w.pushBits(0b1010, 4); // 4 bits: 1010
    w.pushBits(0b110, 3); // 3 bits: 110  -> combined 7 bits: 1010110
    const groups = w.toSevenBitGroups();
    expect(groups).toEqual([0b1010110]);
  });

  it('splits more than 7 bits across multiple groups with right-padding on the last', () => {
    const w = new BitWriter();
    w.pushBits(0b111111111, 9); // 9 bits: 111111111
    // group 1 = first 7 bits = 1111111, group 2 = remaining 2 bits '11' padded to '1100000'
    const groups = w.toSevenBitGroups();
    expect(groups).toEqual([0b1111111, 0b1100000]);
  });
});

describe('encodeSevenBitGroups / decodeSevenBitGroupsForTest round-trip', () => {
  it('encodes values 0-79 into the 0x20-0x6F range', () => {
    const encoded = encodeSevenBitGroups([0, 40, 79]);
    expect(encoded.charCodeAt(0)).toBe(32);
    expect(encoded.charCodeAt(1)).toBe(72);
    expect(encoded.charCodeAt(2)).toBe(111);
  });

  it('encodes values 80-127 into the 0xA1-0xD0 range', () => {
    const encoded = encodeSevenBitGroups([80, 127]);
    expect(encoded.charCodeAt(0)).toBe(161);
    expect(encoded.charCodeAt(1)).toBe(208);
  });

  it('round-trips arbitrary 7-bit group sequences', () => {
    const groups = [0, 1, 79, 80, 100, 127, 50];
    const encoded = encodeSevenBitGroups(groups);
    expect(decodeSevenBitGroupsForTest(encoded)).toEqual(groups);
  });
});

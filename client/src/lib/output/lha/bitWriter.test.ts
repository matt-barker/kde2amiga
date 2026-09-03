import { describe, it, expect } from 'vitest';
import { LhaBitWriter } from './bitWriter';

/**
 * LHA packs its Huffman codes most-significant-bit first, which is the opposite of
 * deflate. `BitWriter` in ../../newicons/sevenBitCodec is deliberately not reused: it
 * emits 7-bit groups for NewIcons tooltypes and has no meaning here.
 */
describe('LhaBitWriter', () => {
  it('writes nothing for no input', () => {
    expect(new LhaBitWriter().toBytes()).toEqual(new Uint8Array([]));
  });

  it('packs bits most-significant-bit first within a byte', () => {
    const writer = new LhaBitWriter();
    writer.putBits(1, 1);
    writer.putBits(1, 0);
    writer.putBits(1, 1);
    writer.putBits(1, 1);
    // 1011 written MSB-first, then zero-padded to a full byte: 0b10110000.
    expect(writer.toBytes()).toEqual(new Uint8Array([0b10110000]));
  });

  it('carries a value across a byte boundary', () => {
    const writer = new LhaBitWriter();
    writer.putBits(4, 0b1111);
    writer.putBits(8, 0b00001111);
    // 1111 then 00001111 = 1111_0000 1111_0000 after padding.
    expect(writer.toBytes()).toEqual(new Uint8Array([0b11110000, 0b11110000]));
  });

  it('writes a 16-bit value as two whole bytes', () => {
    const writer = new LhaBitWriter();
    writer.putBits(16, 0xabcd);
    expect(writer.toBytes()).toEqual(new Uint8Array([0xab, 0xcd]));
  });

  it('pads the final partial byte with zero bits', () => {
    const writer = new LhaBitWriter();
    writer.putBits(3, 0b101);
    expect(writer.toBytes()).toEqual(new Uint8Array([0b10100000]));
  });

  it('ignores bits above the requested count', () => {
    const writer = new LhaBitWriter();
    writer.putBits(4, 0xff);
    expect(writer.toBytes()).toEqual(new Uint8Array([0b11110000]));
  });
});

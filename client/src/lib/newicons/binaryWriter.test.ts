import { describe, it, expect } from 'vitest';
import { BinaryWriter } from './binaryWriter';

describe('BinaryWriter', () => {
  it('writes big-endian words and dwords', () => {
    const w = new BinaryWriter();
    w.writeUByte(0xe3);
    w.writeUByte(0x10);
    w.writeWord(0x0001);
    w.writeDWord(0x00000080);
    const bytes = w.toUint8Array();
    expect(Array.from(bytes)).toEqual([0xe3, 0x10, 0x00, 0x01, 0x00, 0x00, 0x00, 0x80]);
  });

  it('writes raw ASCII strings without a terminator', () => {
    const w = new BinaryWriter();
    w.writeString('IM1=');
    expect(Array.from(w.toUint8Array())).toEqual([0x49, 0x4d, 0x31, 0x3d]);
  });

  it('writes signed longs using two-s-complement big-endian bytes', () => {
    const w = new BinaryWriter();
    w.writeLong(-1);
    expect(Array.from(w.toUint8Array())).toEqual([0xff, 0xff, 0xff, 0xff]);
  });
});

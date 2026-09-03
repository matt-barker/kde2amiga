import { describe, it, expect } from 'vitest';
import { crc16 } from './crc16';

/**
 * LHA stores a CRC-16/ARC of the *uncompressed* file data in every header, and `lha t`
 * checks it — so a wrong polynomial here fails the archive on a real Amiga rather than
 * in our own code. Vectors are the published CRC-16/ARC check values, not values read
 * back out of this implementation.
 */
describe('crc16', () => {
  it('returns 0 for empty input', () => {
    expect(crc16(new Uint8Array([]))).toBe(0);
  });

  it('matches the standard CRC-16/ARC check value for "123456789"', () => {
    const bytes = new TextEncoder().encode('123456789');
    expect(crc16(bytes)).toBe(0xbb3d);
  });

  it('matches the standard CRC-16/ARC value for a single zero byte', () => {
    expect(crc16(new Uint8Array([0x00]))).toBe(0x0000);
  });

  it('matches the standard CRC-16/ARC value for "A"', () => {
    expect(crc16(new TextEncoder().encode('A'))).toBe(0x30c0);
  });
});

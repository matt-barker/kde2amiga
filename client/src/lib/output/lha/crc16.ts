/**
 * CRC-16/ARC: reflected, polynomial 0x8005 (0xA001 reversed), init 0, no final xor.
 *
 * This is the CRC LHA puts in every file header, computed over the *uncompressed*
 * data — not the packed bytes, and not the CRC-16/CCITT that the name "CRC-16" more
 * often means elsewhere. `lha t` verifies it, so getting the polynomial wrong yields
 * archives that unpack but report corruption.
 */
const TABLE = (() => {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? (value >>> 1) ^ 0xa001 : value >>> 1;
    }
    table[i] = value;
  }
  return table;
})();

export function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ TABLE[(crc ^ byte) & 0xff];
  }
  return crc;
}

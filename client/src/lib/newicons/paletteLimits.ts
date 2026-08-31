export const MAX_LINE_PAYLOAD_BYTES = 123; // 127 - 4 for "IM1="/"IM2="
export const HEADER_CHARS = 5;
const BITS_PER_CHAR = 7;
const BITS_PER_PALETTE_ENTRY = 24; // 8 bits each of R, G, B

export function maxColorsForSingleLine(): number {
  const availableBits = (MAX_LINE_PAYLOAD_BYTES - HEADER_CHARS) * BITS_PER_CHAR;
  return Math.floor(availableBits / BITS_PER_PALETTE_ENTRY);
}

export function bitCountForColors(colorCount: number): number {
  let bits = 1;
  while (1 << bits < colorCount) bits++;
  return bits;
}

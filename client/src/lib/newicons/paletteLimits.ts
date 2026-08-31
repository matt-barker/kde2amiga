export const MAX_LINE_PAYLOAD_BYTES = 123; // 127 - 4 for "IM1="/"IM2="
export const HEADER_CHARS = 5; // five RAW characters, not 7-bit encoded
const BITS_PER_CHAR = 7;
const BITS_PER_PALETTE_ENTRY = 24; // 8 bits each of R, G, B

/**
 * Largest palette whose header + palette still fits on the first ToolType line.
 *
 * First line length = 4 (the "IM1="/"IM2=" prefix)
 *                   + 5 (the raw header characters)
 *                   + ceil(24 * n / 7) (the 7-bit-encoded palette)
 *
 * n = 34 -> 4 + 5 + ceil(816/7) = 4 + 5 + 117 = 126 <= 127.
 * n = 35 -> 4 + 5 + ceil(840/7) = 4 + 5 + 120 = 129 >  127.
 *
 * So 34 is the cap, and it is tight. The raw-header fix does not move it: five raw
 * characters cost exactly the same as the five 7-bit groups the old (wrong) encoder used.
 */
export function maxColorsForSingleLine(): number {
  const availableBits = (MAX_LINE_PAYLOAD_BYTES - HEADER_CHARS) * BITS_PER_CHAR;
  return Math.floor(availableBits / BITS_PER_PALETTE_ENTRY);
}

export function bitCountForColors(colorCount: number): number {
  let bits = 1;
  while (1 << bits < colorCount) bits++;
  return bits;
}

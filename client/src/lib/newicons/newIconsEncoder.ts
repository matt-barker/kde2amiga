import { BitWriter, encodeSevenBitGroups } from './sevenBitCodec';
import { bitCountForColors, MAX_LINE_PAYLOAD_BYTES } from './paletteLimits';

export interface NewIconState {
  width: number;
  height: number;
  transparent: boolean;
  palette: [number, number, number][];
  pixels: number[]; // palette indices, row-major, length width*height
}

function chunkString(s: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < s.length; i += size) chunks.push(s.slice(i, i + size));
  return chunks;
}

export function encodeNewIconState(state: NewIconState, prefix: 'IM1=' | 'IM2='): string[] {
  const { width, height, transparent, palette, pixels } = state;
  const colorCount = palette.length;

  // --- Line 1 payload: header (raw bytes) + palette (seven-bit encoded) ---
  let firstLinePayload = String.fromCharCode(transparent ? 66 : 78); // 'B' or 'N'
  firstLinePayload += String.fromCharCode(width + 33);
  firstLinePayload += String.fromCharCode(height + 33);
  firstLinePayload += String.fromCharCode(((colorCount >> 6) & 0x3f) + 33);
  firstLinePayload += String.fromCharCode((colorCount & 0x3f) + 33);

  const paletteBits = new BitWriter();
  for (const [r, g, b] of palette) {
    paletteBits.pushBits(r, 8);
    paletteBits.pushBits(g, 8);
    paletteBits.pushBits(b, 8);
  }
  firstLinePayload += encodeSevenBitGroups(paletteBits.toSevenBitGroups());

  // --- Remaining lines: pixel indices ---
  const bitCount = bitCountForColors(colorCount);
  const pixelBits = new BitWriter();
  for (const index of pixels) pixelBits.pushBits(index, bitCount);
  const pixelPayload = encodeSevenBitGroups(pixelBits.toSevenBitGroups());

  const lines = [prefix + firstLinePayload];
  for (const chunk of chunkString(pixelPayload, MAX_LINE_PAYLOAD_BYTES)) {
    lines.push(prefix + chunk);
  }
  return lines;
}

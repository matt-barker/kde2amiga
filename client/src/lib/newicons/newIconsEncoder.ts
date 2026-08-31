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

  // --- Line 1 payload: header + full palette ---
  const headerAndPalette = new BitWriter();
  headerAndPalette.pushBits(transparent ? 66 : 78, 7); // 'B' or 'N', both < 128
  headerAndPalette.pushBits(width + 33, 7);
  headerAndPalette.pushBits(height + 33, 7);
  headerAndPalette.pushBits(((colorCount >> 6) & 0x3f) + 33, 7);
  headerAndPalette.pushBits((colorCount & 0x3f) + 33, 7);
  for (const [r, g, b] of palette) {
    headerAndPalette.pushBits(r, 8);
    headerAndPalette.pushBits(g, 8);
    headerAndPalette.pushBits(b, 8);
  }
  const firstLinePayload = encodeSevenBitGroups(headerAndPalette.toSevenBitGroups());

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

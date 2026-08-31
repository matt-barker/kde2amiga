import { BitWriter, encodeSevenBitGroups } from './sevenBitCodec';
import { bitCountForColors, MAX_LINE_PAYLOAD_BYTES } from './paletteLimits';

export interface NewIconState {
  width: number;
  height: number;
  transparent: boolean;
  palette: [number, number, number][];
  pixels: number[]; // palette indices, row-major, length width*height
}

/**
 * Encode one NewIcons image state as a list of `IM1=`/`IM2=` ToolType lines.
 *
 * Layout (verified against the real NewIcons files in steffest/Amiga-Icon-converter,
 * `test-icons/Newicons/Apps.info` and `0016.info`, and against its `decodeNewIcon`):
 *
 *  - The first line is `IM1=` + five RAW header characters + the 7-bit-encoded palette.
 *    The header characters are NOT run through the 7-bit encoder: the reference decoder
 *    reads them straight off the payload with `data.charCodeAt(0..4)` and only then does
 *    `data = data.substr(5)` before bit-decoding the palette.
 *      [0] 'B' (66) if transparent, 'N' (78) if not
 *      [1] width + 33
 *      [2] height + 33
 *      [3] (colorCount >> 6) + 33
 *      [4] (colorCount & 0x3f) + 33
 *    e.g. Apps.info's IM1 header is [66,69,73,33,41] = "BEI!)" -> transparent, 36x40, 8 colours.
 *
 *  - Every following line is an INDEPENDENT bit stream. The reference decodes each line on
 *    its own and floors to whole pixels (`Math.floor(bits.length / bitCount)`), discarding the
 *    sub-`bitCount` remainder at the end of each line. So pixels must be packed per line and
 *    never sliced out of one continuous stream, or every line after the first is misaligned.
 */
export function encodeNewIconState(state: NewIconState, prefix: 'IM1=' | 'IM2='): string[] {
  const { width, height, transparent, palette, pixels } = state;
  const colorCount = palette.length;

  // --- Line 1: raw 5-character header, then the 7-bit-encoded palette ---
  const header = String.fromCharCode(
    transparent ? 66 : 78, // 'B' / 'N'
    width + 33,
    height + 33,
    ((colorCount >> 6) & 0x3f) + 33,
    (colorCount & 0x3f) + 33,
  );

  const paletteBits = new BitWriter();
  for (const [r, g, b] of palette) {
    paletteBits.pushBits(r, 8);
    paletteBits.pushBits(g, 8);
    paletteBits.pushBits(b, 8);
  }

  const lines = [prefix + header + encodeSevenBitGroups(paletteBits.toSevenBitGroups())];

  // --- Remaining lines: pixel indices, packed independently per line ---
  const bitCount = bitCountForColors(colorCount);
  const pixelsPerLine = Math.floor((MAX_LINE_PAYLOAD_BYTES * 7) / bitCount);
  for (let i = 0; i < pixels.length; i += pixelsPerLine) {
    const lineBits = new BitWriter();
    for (const index of pixels.slice(i, i + pixelsPerLine)) lineBits.pushBits(index, bitCount);
    lines.push(prefix + encodeSevenBitGroups(lineBits.toSevenBitGroups()));
  }

  return lines;
}

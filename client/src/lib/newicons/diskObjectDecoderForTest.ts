import type { NewIconState } from './newIconsEncoder';

class Reader {
  private pos = 0;
  private bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  ubyte(): number { return this.bytes[this.pos++]; }
  word(): number { const v = (this.bytes[this.pos] << 8) | this.bytes[this.pos + 1]; this.pos += 2; return v; }
  dword(): number {
    const v = (this.bytes[this.pos] * 2 ** 24) + (this.bytes[this.pos + 1] << 16) + (this.bytes[this.pos + 2] << 8) + this.bytes[this.pos + 3];
    this.pos += 4;
    return v >>> 0;
  }
  skip(n: number): void { this.pos += n; }
  get index(): number { return this.pos; }
  set index(v: number) { this.pos = v; }
}

/**
 * Faithful port of `decodeBits` from steffest/Amiga-Icon-converter's `icon.js` (MIT).
 *
 *   byte <  160 -> 7 bits, value byte - 32
 *   byte <  209 -> 7 bits, value byte - 81
 *   byte >= 209 -> RLE: (byte - 208) groups of seven zero bits
 *
 * We deliberately emit literals only, but real NewIcons files in the wild do use the RLE
 * branch (Apps.info's IM1 palette line is one such), so a decoder that claims to be the
 * reference has to handle it.
 */
function decodeBits(data: string): string {
  let bits = '';
  for (let i = 0; i < data.length; i++) {
    const byte = data.charCodeAt(i);
    let chunk: string;
    if (byte < 160) {
      chunk = (byte - 32).toString(2);
    } else if (byte < 209) {
      chunk = (byte - 81).toString(2);
    } else {
      // RLE - only ever used for filling with zeroes
      chunk = '';
      for (let j = 0; j < byte - 208; j++) chunk += '0000000';
      bits += chunk;
      continue;
    }
    bits += chunk.padStart(7, '0');
  }
  return bits;
}

export interface DecodedNewIcon extends NewIconState {
  /**
   * Total pixels the reference decoder would have pushed, before trimming to width*height.
   * Real files pad the last line, so this is >= width*height.
   */
  decodedPixelCount: number;
  colorCount: number;
  bitCount: number;
}

/**
 * Faithful port of `decodeNewIcon` from steffest/Amiga-Icon-converter's `icon.js` (MIT),
 * restricted to a single image state (one `IM1=`/`IM2=` group), with the "IMn=" prefix
 * already stripped from each line.
 *
 * Two things this must get right, and which our encoder previously got wrong:
 *  - The five header characters are read RAW off the first line; bit-decoding starts at
 *    character 5.
 *  - Each pixel line is an independent bit stream, floored to whole pixels; lines are
 *    never concatenated before bit-splitting.
 */
export function decodeNewIconLines(lines: string[]): DecodedNewIcon {
  const first = lines[0];
  const transparent = first.charCodeAt(0) === 66; // 'B'
  const width = first.charCodeAt(1) - 33;
  const height = first.charCodeAt(2) - 33;
  const colorCount = ((first.charCodeAt(3) - 33) << 6) + first.charCodeAt(4) - 33;

  let bitCount = 1;
  while (1 << bitCount < colorCount) bitCount++;

  const paletteBits = decodeBits(first.substring(5));
  const palette: [number, number, number][] = [];
  const maxEntries = Math.floor(paletteBits.length / 8 / 3);
  for (let i = 0; i < maxEntries; i++) {
    const base = i * 24;
    palette.push([
      parseInt(paletteBits.substring(base, base + 8), 2),
      parseInt(paletteBits.substring(base + 8, base + 16), 2),
      parseInt(paletteBits.substring(base + 16, base + 24), 2),
    ]);
  }

  const pixels: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const bits = decodeBits(lines[i]);
    const max = Math.floor(bits.length / bitCount);
    for (let p = 0; p < max; p++) {
      pixels.push(parseInt(bits.substring(p * bitCount, p * bitCount + bitCount), 2));
    }
  }

  return {
    width,
    height,
    transparent,
    colorCount,
    bitCount,
    // The reference keeps every palette entry the bits allow, including padding entries;
    // only the first colorCount of them are real.
    palette: palette.slice(0, colorCount),
    decodedPixelCount: pixels.length,
    pixels: pixels.slice(0, width * height),
  };
}

/** Reference `readIconImage`, without keeping the pixels: it only needs to advance the cursor. */
function skipClassicImage(r: Reader): void {
  r.word(); // leftEdge
  r.word(); // topEdge
  const imgWidth = r.word();
  const imgHeight = r.word();
  const depth = r.word();
  const hasImageData = r.dword();
  r.ubyte(); // planePick
  r.ubyte(); // planeOnOff
  r.dword(); // nextImage
  if (hasImageData) {
    const rowBytes = ((imgWidth + 15) >> 4) << 1;
    r.skip(rowBytes * imgHeight * depth);
  }
}

/** Reference `readText`: DWORD length (including the trailing NUL), then that many bytes. */
function readText(r: Reader): string {
  const len = r.dword();
  let s = '';
  for (let i = 0; i < len - 1; i++) s += String.fromCharCode(r.ubyte());
  r.ubyte(); // NUL
  return s;
}

export function decodeInfoFileForTest(bytes: Uint8Array) {
  const r = new Reader(bytes);
  const magic = r.word();
  r.word(); // version
  r.dword(); // nextGadget
  r.word(); // leftEdge
  r.word(); // topEdge
  const width = r.word();
  const height = r.word();
  r.word(); // flags
  r.word(); // activation
  r.word(); // gadgetType
  r.dword(); // gadgetRender
  const selectRender = r.dword();
  r.dword(); // gadgetText
  r.dword(); // mutualExclude
  r.dword(); // specialInfo
  r.word(); // gadgetID
  r.dword(); // userData
  const type = r.ubyte();
  r.ubyte(); // padding
  const hasDefaultTool = r.dword();
  const hasToolTypes = r.dword();
  r.dword(); // currentX
  r.dword(); // currentY
  const hasDrawerData = r.dword();
  r.dword(); // hasToolWindow
  r.dword(); // stackSize
  // total header size 78 bytes

  if (hasDrawerData) r.skip(56); // OS1.x DrawerData, as the reference skips it

  // The reference always reads a first image, and a second one only if selectRender is set.
  skipClassicImage(r);
  if (selectRender) skipClassicImage(r);

  if (hasDefaultTool) readText(r);

  const toolTypes: string[] = [];
  if (hasToolTypes) {
    const countField = r.dword();
    const count = countField ? countField / 4 - 1 : 0;
    for (let i = 0; i < count; i++) toolTypes.push(readText(r));
  }

  const im1Lines = toolTypes.filter((t) => t.startsWith('IM1=')).map((t) => t.slice(4));
  const im2Lines = toolTypes.filter((t) => t.startsWith('IM2=')).map((t) => t.slice(4));

  return {
    magic,
    type,
    width,
    height,
    toolTypes,
    /** IM1= payloads with the 4-character prefix stripped, in file order. */
    im1Lines,
    /** IM2= payloads with the 4-character prefix stripped, in file order. */
    im2Lines,
    normal: decodeNewIconLines(im1Lines),
    selected: decodeNewIconLines(im2Lines),
  };
}

/** Exposed so tests can inspect raw bit lengths per line. */
export { decodeBits as decodeBitsForTest };

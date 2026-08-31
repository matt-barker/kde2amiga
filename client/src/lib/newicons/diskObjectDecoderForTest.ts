import type { NewIconState } from './newIconsEncoder';

class Reader {
  private pos = 0;
  constructor(private bytes: Uint8Array) {}
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

function decodeSevenBitLiteral(encoded: string): number[] {
  const groups: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    const byte = encoded.charCodeAt(i);
    groups.push(byte < 160 ? byte - 32 : byte - 81);
  }
  return groups;
}

function groupsToBitString(groups: number[]): string {
  return groups.map((g) => g.toString(2).padStart(7, '0')).join('');
}

function decodeNewIconLines(lines: string[]): NewIconState {
  const firstPayload = lines[0];
  const firstBits = groupsToBitString(decodeSevenBitLiteral(firstPayload));
  const transparent = decodeSevenBitLiteral(firstPayload.slice(0, 1))[0] === 66;
  const width = decodeSevenBitLiteral(firstPayload.slice(1, 2))[0] - 33;
  const height = decodeSevenBitLiteral(firstPayload.slice(2, 3))[0] - 33;
  const hi = decodeSevenBitLiteral(firstPayload.slice(3, 4))[0] - 33;
  const lo = decodeSevenBitLiteral(firstPayload.slice(4, 5))[0] - 33;
  const colorCount = (hi << 6) + lo;

  // header is 5 chars * 7 bits = 35 bits into firstBits; palette follows
  const paletteBits = firstBits.slice(35, 35 + colorCount * 24);
  const palette: [number, number, number][] = [];
  for (let i = 0; i < colorCount; i++) {
    const base = i * 24;
    const r = parseInt(paletteBits.slice(base, base + 8), 2);
    const g = parseInt(paletteBits.slice(base + 8, base + 16), 2);
    const b = parseInt(paletteBits.slice(base + 16, base + 24), 2);
    palette.push([r, g, b]);
  }

  let bitCount = 1;
  while (1 << bitCount < colorCount) bitCount++;

  const pixelPayload = lines.slice(1).join('');
  const pixelBits = groupsToBitString(decodeSevenBitLiteral(pixelPayload));
  const pixelCount = width * height;
  const pixels: number[] = [];
  for (let i = 0; i < pixelCount; i++) {
    pixels.push(parseInt(pixelBits.slice(i * bitCount, i * bitCount + bitCount), 2));
  }

  return { width, height, transparent, palette, pixels };
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
  r.dword(); // selectRender
  r.dword(); // gadgetText
  r.dword(); // mutualExclude
  r.dword(); // specialInfo
  r.word(); // gadgetID
  r.dword(); // userData
  const type = r.ubyte();
  r.ubyte(); // padding
  r.dword(); // hasDefaultTool
  const hasToolTypes = r.dword();
  r.dword(); // currentX
  r.dword(); // currentY
  r.dword(); // hasDrawerData
  r.dword(); // hasToolWindow
  r.dword(); // stackSize

  // two classic images
  for (let i = 0; i < 2; i++) {
    r.word(); r.word(); // leftEdge, topEdge
    const imgWidth = r.word();
    const imgHeight = r.word();
    const depth = r.word();
    r.dword(); // hasImageData
    r.ubyte(); r.ubyte(); // planePick, planeOnOff
    r.dword(); // nextImage
    const rowBytes = ((imgWidth + 15) >> 4) << 1;
    r.skip(rowBytes * imgHeight * depth);
  }

  const toolTypes: string[] = [];
  if (hasToolTypes) {
    const countField = r.dword();
    const count = countField ? countField / 4 - 1 : 0;
    for (let i = 0; i < count; i++) {
      const len = r.dword();
      let s = '';
      for (let j = 0; j < len - 1; j++) s += String.fromCharCode(r.ubyte());
      r.ubyte(); // NUL
      toolTypes.push(s);
    }
  }

  const im1Lines = toolTypes.filter((t) => t.startsWith('IM1=')).map((t) => t.slice(4));
  const im2Lines = toolTypes.filter((t) => t.startsWith('IM2=')).map((t) => t.slice(4));

  return {
    magic,
    type,
    width,
    height,
    normal: decodeNewIconLines(im1Lines),
    selected: decodeNewIconLines(im2Lines),
  };
}

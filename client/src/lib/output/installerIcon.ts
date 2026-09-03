import { buildInfoFile } from '../newicons/diskObject';
import type { NewIconState } from '../newicons/newIconsEncoder';
import { INSTALLER_DEFAULT_TOOL } from './installerScript';

export const INSTALLER_ICON_SIZE = 32;

/**
 * The installer's artwork, one character per pixel.
 *
 * Drawn here rather than taken from the user's converted pack on purpose: the installer
 * is ours, not theirs, so it should look the same in every download, and building it
 * from a literal keeps it synchronous and free of the rasteriser, the quantiser and the
 * theme zip. Edit the picture to change the icon.
 *
 *   ' ' transparent   'k' outline   'b' arrow   'g' tray   'w' tray highlight
 */
const GLYPH = [
  '                                ',
  '                                ',
  '            kkkkkkkk            ',
  '            kbbbbbbk            ',
  '            kbbbbbbk            ',
  '            kbbbbbbk            ',
  '            kbbbbbbk            ',
  '            kbbbbbbk            ',
  '            kbbbbbbk            ',
  '            kbbbbbbk            ',
  '            kbbbbbbk            ',
  '            kbbbbbbk            ',
  '            kbbbbbbk            ',
  '            kbbbbbbk            ',
  '            kbbbbbbk            ',
  '            kbbbbbbk            ',
  '        kkkkbbbbbbbbkkkk        ',
  '         kbbbbbbbbbbbbk         ',
  '          kbbbbbbbbbbk          ',
  '           kbbbbbbbbk           ',
  '            kbbbbbbk            ',
  '             kbbbbk             ',
  '              kbbk              ',
  '               kk               ',
  '                                ',
  '                                ',
  '   kkkkkkkkkkkkkkkkkkkkkkkkkk   ',
  '   kwwwwwwwwwwwwwwwwwwwwwwwwk   ',
  '   kggggggggggggggggggggggggk   ',
  '   kggggggggggggggggggggggggk   ',
  '   kkkkkkkkkkkkkkkkkkkkkkkkkk   ',
  '                                ',
];

/**
 * Index 0 is the transparency hole, so its colour is never drawn — the standard
 * Workbench grey only makes it obvious what the hole sits on if anything ever shows it.
 */
const INK: Record<string, [number, number, number]> = {
  ' ': [0xab, 0xab, 0xab],
  k: [0x00, 0x00, 0x00],
  b: [0x30, 0x60, 0xc0],
  g: [0xaa, 0xaa, 0xaa],
  w: [0xff, 0xff, 0xff],
};

const CHARS = Object.keys(INK);

/**
 * One palette for both states, with every ink followed by its inverse.
 *
 * The NewIcons format would allow each state its own palette, but nothing else in this
 * codebase does it that way — `prepareIcon` gives both states a shared palette, and that
 * is the arrangement verified on hardware. Carrying the inverses as extra entries buys
 * the pressed look without departing from it; nine entries is nothing against the 34 a
 * single-line palette allows.
 */
const PALETTE: [number, number, number][] = [
  ...CHARS.map((char) => INK[char]),
  ...CHARS.map((char) => INK[char].map((c) => 255 - c) as [number, number, number]),
];

function glyphPixels(): number[] {
  const pixels: number[] = [];
  for (let y = 0; y < INSTALLER_ICON_SIZE; y++) {
    for (let x = 0; x < INSTALLER_ICON_SIZE; x++) {
      const index = CHARS.indexOf(GLYPH[y][x]);
      if (index < 0) throw new Error(`Unknown ink '${GLYPH[y][x]}' in the installer glyph`);
      pixels.push(index);
    }
  }
  return pixels;
}

function state(pixels: number[]): NewIconState {
  return {
    width: INSTALLER_ICON_SIZE,
    height: INSTALLER_ICON_SIZE,
    transparent: true,
    palette: PALETTE,
    pixels,
  };
}

/**
 * The `.info` for the "Install Default Icons" script: an ordinary project icon whose
 * default tool is IconX, which is what makes an AmigaDOS script double-clickable from
 * Workbench.
 */
export function buildInstallerIcon(): Uint8Array {
  const normal = glyphPixels();
  // Index 0 stays 0: inverting the transparency hole would fill it in.
  const selected = normal.map((index) => (index === 0 ? 0 : index + CHARS.length));

  return buildInfoFile({
    width: INSTALLER_ICON_SIZE,
    height: INSTALLER_ICON_SIZE,
    kind: 'project',
    normal: state(normal),
    selected: state(selected),
    defaultTool: INSTALLER_DEFAULT_TOOL,
  });
}

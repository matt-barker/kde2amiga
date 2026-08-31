import { describe, it, expect } from 'vitest';
import { buildInfoFile } from './diskObject';
import { decodeInfoFileForTest } from './diskObjectDecoderForTest';
import type { NewIconState } from './newIconsEncoder';

function makeState(width: number, height: number): NewIconState {
  const palette: [number, number, number][] = [
    [0, 0, 0],
    [255, 255, 255],
    [200, 40, 40],
  ];
  const pixels = new Array(width * height).fill(0).map((_, i) => i % palette.length);
  return { width, height, transparent: true, palette, pixels };
}

describe('buildInfoFile', () => {
  it('starts with the 0xE310 magic number', () => {
    const bytes = buildInfoFile({
      width: 4,
      height: 4,
      kind: 'project',
      normal: makeState(4, 4),
      selected: makeState(4, 4),
    });
    expect(bytes[0]).toBe(0xe3);
    expect(bytes[1]).toBe(0x10);
  });

  it('round-trips icon type, dimensions, and both NewIcons image states', () => {
    const normal = makeState(4, 4);
    const selected = makeState(4, 4);
    const bytes = buildInfoFile({ width: 4, height: 4, kind: 'drawer', normal, selected });
    const decoded = decodeInfoFileForTest(bytes);

    expect(decoded.type).toBe(2); // drawer
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
    expect(decoded.normal.palette).toEqual(normal.palette);
    expect(decoded.normal.pixels).toEqual(normal.pixels);
    expect(decoded.selected.pixels).toEqual(selected.pixels);
  });

  it('writes a 56-byte DrawerData block plus a 6-byte OS2.x tail for drawer and trashcan icons, and still decodes correctly', () => {
    for (const kind of ['drawer', 'trashcan'] as const) {
      const normal = makeState(4, 4);
      const selected = makeState(4, 4);
      const withDrawerData = buildInfoFile({ width: 4, height: 4, kind, normal, selected });
      const withoutDrawerData = buildInfoFile({ width: 4, height: 4, kind: 'project', normal, selected });

      // The only structural difference between a drawer/trashcan icon and a plain one
      // should be the 56-byte DrawerData block plus the 6-byte OS2.x/3.x dd_Flags/
      // dd_ViewModes tail written after ToolTypes (plus the do_Type byte and the
      // hasDrawerData flag itself, which don't affect length).
      expect(withDrawerData.length).toBe(withoutDrawerData.length + 56 + 6);

      // The last 6 bytes of the file must be the zeroed dd_Flags (LONG) + dd_ViewModes
      // (UWORD) tail; without it a real decoder walks off the end of the buffer.
      const tail = withDrawerData.slice(withDrawerData.length - 6);
      expect(Array.from(tail)).toEqual([0, 0, 0, 0, 0, 0]);

      const decoded = decodeInfoFileForTest(withDrawerData);
      expect(decoded.width).toBe(4);
      expect(decoded.height).toBe(4);
      expect(decoded.normal.palette).toEqual(normal.palette);
      expect(decoded.normal.pixels).toEqual(normal.pixels);
      expect(decoded.selected.pixels).toEqual(selected.pixels);
    }
  });

  it('does not write DrawerData for non-drawer, non-trashcan kinds', () => {
    const normal = makeState(4, 4);
    const selected = makeState(4, 4);
    for (const kind of ['disk', 'tool', 'project'] as const) {
      const bytes = buildInfoFile({ width: 4, height: 4, kind, normal, selected });
      // hasDrawerData is the DWORD at offset 66 (see the 78-byte header layout).
      const hasDrawerData = (bytes[66] << 24) | (bytes[67] << 16) | (bytes[68] << 8) | bytes[69];
      expect(hasDrawerData).toBe(0);
    }
  });

  it('round-trips a 32x32 icon whose payload spans multiple IM1=/IM2= lines', () => {
    function makeBigState(width: number, height: number): NewIconState {
      const palette: [number, number, number][] = Array.from({ length: 16 }, (_, i) => [
        i * 16,
        255 - i * 16,
        (i * 37) % 256,
      ]);
      const pixels = new Array(width * height).fill(0).map((_, i) => i % palette.length);
      return { width, height, transparent: false, palette, pixels };
    }

    const normal = makeBigState(32, 32);
    const selected = makeBigState(32, 32);
    const bytes = buildInfoFile({ width: 32, height: 32, kind: 'tool', normal, selected });
    const decoded = decodeInfoFileForTest(bytes);

    // Every ToolType line must fit the 127-character limit Workbench imposes.
    for (const line of decoded.toolTypes) expect(line.length).toBeLessThanOrEqual(127);
    // 16 colours -> 4 bits/pixel -> floor(123*7/4) = 215 pixels per line -> 5 pixel lines,
    // plus the header/palette line: 4 + 5 + ceil(16*24/7) = 64 characters.
    expect(decoded.im1Lines).toHaveLength(6);
    expect(decoded.im1Lines[0]).toHaveLength(60); // 64 minus the stripped "IM1=" prefix

    expect(decoded.width).toBe(32);
    expect(decoded.height).toBe(32);
    expect(decoded.normal.width).toBe(32);
    expect(decoded.normal.height).toBe(32);
    expect(decoded.normal.palette).toEqual(normal.palette);
    expect(decoded.normal.pixels).toEqual(normal.pixels);
    expect(decoded.selected.width).toBe(32);
    expect(decoded.selected.height).toBe(32);
    expect(decoded.selected.palette).toEqual(selected.palette);
    expect(decoded.selected.pixels).toEqual(selected.pixels);
  });
});

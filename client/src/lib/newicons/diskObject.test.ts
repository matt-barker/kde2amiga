import { describe, it, expect } from 'vitest';
import { buildInfoFile, type IconKind } from './diskObject';
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

  /*
   * `disk` was in this list once, asserting the very defect it was meant to guard against:
   * workbench.h requires do_DrawerData for WBDISK as much as for WBDRAWER. See the
   * "do_DrawerData by icon type" tests below for the rule and the hardware evidence.
   */
  it('does not write DrawerData for kinds that open no window', () => {
    const normal = makeState(4, 4);
    const selected = makeState(4, 4);
    for (const kind of ['tool', 'project'] as const) {
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
  // Verified on real hardware (A1200 / OS 3.2.2, icon.library 47.5): an icon whose
  // ToolTypes carry only the IM1=/IM2= lines renders as the plain classic fallback and
  // its NewIcons data is shown verbatim in the Icon Information window. Adding exactly
  // these two leading entries -- and changing nothing else -- makes Workbench decode and
  // draw the NewIcons image. See newIconsFixtures.test.ts for the same two entries in
  // the real, in-the-wild fixtures.
  it('precedes the IM1=/IM2= lines with the NewIcons preamble ToolTypes', () => {
    const bytes = buildInfoFile({
      width: 4,
      height: 4,
      kind: 'project',
      normal: makeState(4, 4),
      selected: makeState(4, 4),
    });
    const decoded = decodeInfoFileForTest(bytes);

    expect(decoded.toolTypes[0]).toBe(' ');
    expect(decoded.toolTypes[1]).toBe("*** DON'T EDIT THE FOLLOWING LINES!! ***");
    expect(decoded.toolTypes[2].startsWith('IM1=')).toBe(true);
  });

  /**
   * A project icon's do_DefaultTool is the program Workbench runs on double-click. The
   * archive's own installer icon needs one set, and so does a converted icon that
   * replaces a Workbench project icon such as `SYS:System/Shell`; every other icon we
   * write leaves it empty, which is why it stayed hardcoded to 0 until now.
   *
   * The string is written between the select-render image and the ToolTypes array,
   * which is where the .info layout puts it - get the order wrong and the decoder
   * reads the DefaultTool's length field as the ToolTypes count.
   */
  it('round-trips a default tool alongside the NewIcons ToolTypes', () => {
    const bytes = buildInfoFile({
      width: 4,
      height: 4,
      kind: 'project',
      normal: makeState(4, 4),
      selected: makeState(4, 4),
      defaultTool: 'IconX',
    });
    const decoded = decodeInfoFileForTest(bytes);

    expect(decoded.defaultTool).toBe('IconX');
    // The image payload has to survive the insertion, not just the string itself.
    expect(decoded.normal.pixels).toEqual(makeState(4, 4).pixels);
    expect(decoded.toolTypes.filter((t) => t.startsWith('IM1=')).length).toBeGreaterThan(0);
  });

  it('writes no default tool, and no space for one, when none is asked for', () => {
    const decoded = decodeInfoFileForTest(
      buildInfoFile({
        width: 4,
        height: 4,
        kind: 'project',
        normal: makeState(4, 4),
        selected: makeState(4, 4),
      }),
    );
    expect(decoded.defaultTool).toBeUndefined();
  });

  it('round-trips a default tool on a drawer icon, whose DrawerData shifts every offset', () => {
    const decoded = decodeInfoFileForTest(
      buildInfoFile({
        width: 4,
        height: 4,
        kind: 'drawer',
        normal: makeState(4, 4),
        selected: makeState(4, 4),
        defaultTool: 'SYS:Tools/IconX',
      }),
    );
    expect(decoded.defaultTool).toBe('SYS:Tools/IconX');
    expect(decoded.type).toBe(2);
  });

  /**
   * Carried ToolTypes go ahead of the NewIcons payload for two reasons: the preamble
   * says "don't edit the following lines", which is only true if the editable ones come
   * first; and a tool scanning for DONOTWAIT should not have to read past a few hundred
   * lines of encoded pixels to find it.
   */
  it('writes carried ToolTypes ahead of the NewIcons preamble', () => {
    const bytes = buildInfoFile({
      width: 4,
      height: 4,
      kind: 'tool',
      normal: makeState(4, 4),
      selected: makeState(4, 4),
      toolTypes: ['DONOTWAIT', 'STARTPRI=30'],
    });
    const decoded = decodeInfoFileForTest(bytes);

    expect(decoded.toolTypes.slice(0, 3)).toEqual(['DONOTWAIT', 'STARTPRI=30', ' ']);
    expect(decoded.toolTypes[3]).toBe("*** DON'T EDIT THE FOLLOWING LINES!! ***");
  });

  it('still decodes both image states with ToolTypes carried in front of them', () => {
    const normal = makeState(4, 4);
    const selected = makeState(4, 4);
    const decoded = decodeInfoFileForTest(
      buildInfoFile({
        width: 4,
        height: 4,
        kind: 'project',
        normal,
        selected,
        defaultTool: 'C:IconX',
        toolTypes: ['WINDOW=CON:0///130/AmigaShell/CLOSE/ICONIFY'],
      }),
    );

    expect(decoded.defaultTool).toBe('C:IconX');
    expect(decoded.normal.pixels).toEqual(normal.pixels);
    expect(decoded.selected.pixels).toEqual(selected.pixels);
  });

  /**
   * Pins the change as purely additive. Every icon in the archive that carries no
   * ToolTypes must come out exactly as it did before, or this task has silently
   * rewritten the entire output of the converter.
   */
  it('is byte-identical to an icon built without the parameter when none are carried', () => {
    const shared = {
      width: 4,
      height: 4,
      kind: 'tool',
      normal: makeState(4, 4),
      selected: makeState(4, 4),
    } as const;

    expect(buildInfoFile({ ...shared, toolTypes: [] })).toEqual(buildInfoFile(shared));
  });
});

/**
 * `do_DrawerData` is required for WBDISK (1), WBDRAWER (2) and WBGARBAGE (5) — every icon
 * type that opens a window — and meaningless for WBTOOL (3) and WBPROJECT (4).
 *
 * Disk was missing from that set once, so `def_disk.info` declared type 1 while claiming
 * no DrawerData. Directory Opus on OS 3.2.3 dropped the file from its listing entirely
 * while every other `def_*` icon showed, which is what a reader does when the type byte
 * promises a structure that is not there.
 *
 * Nothing round-trip can catch this: our own decoder reads `hasDrawerData` out of the file
 * rather than deriving it from the type, so it faithfully reproduces a wrong flag. The
 * reference is `Disk.info` from a real 3.2.3 install, which carries DrawerData with type 1.
 */
describe('do_DrawerData by icon type', () => {
  const hasDrawerData = (kind: IconKind) => {
    const bytes = buildInfoFile({
      width: 8, height: 8, kind, normal: makeState(8, 8), selected: makeState(8, 8),
    });
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(66) !== 0;
  };

  it('writes DrawerData for every icon type that opens a window', () => {
    expect(hasDrawerData('disk')).toBe(true);
    expect(hasDrawerData('drawer')).toBe(true);
    expect(hasDrawerData('trashcan')).toBe(true);
  });

  it('omits it for tools and projects, which have no window', () => {
    expect(hasDrawerData('tool')).toBe(false);
    expect(hasDrawerData('project')).toBe(false);
  });

  it('makes a disk icon exactly the 62 bytes longer that DrawerData and its tail cost', () => {
    const of = (kind: IconKind) =>
      buildInfoFile({
        width: 8, height: 8, kind, normal: makeState(8, 8), selected: makeState(8, 8),
      }).length;
    // 56 bytes of DrawerData after the header, plus the 6-byte OS2.x tail after ToolTypes.
    expect(of('disk') - of('tool')).toBe(62);
  });
});

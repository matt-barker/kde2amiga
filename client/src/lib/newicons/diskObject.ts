import { BinaryWriter } from './binaryWriter';
import { packClassicImageBitplane } from './classicImage';
import { encodeNewIconState, type NewIconState } from './newIconsEncoder';

export type IconKind = 'disk' | 'drawer' | 'tool' | 'project' | 'trashcan';

/**
 * The two ToolType entries that must precede the IM1=/IM2= lines.
 *
 * Not decoration: without them AmigaOS does not recognise the ToolTypes as NewIcons data
 * at all. Workbench then draws the classic planar fallback (see `classicImage.ts`) and
 * lists the IM1=/IM2= lines verbatim in the Icon Information window.
 *
 * Verified on real hardware — A1200 / OS 3.2.3, icon.library 47.5 — by rendering two
 * files that differed in nothing but these entries: without them a plain box, with them
 * the full-colour NewIcons image. Both vendored real-world fixtures carry them as their
 * first two ToolTypes (see `newIconsFixtures.test.ts`), and icon.library 47.5's own
 * string table contains this exact marker alongside its "IM1=" and "IM2=" literals.
 *
 * Note that third-party NewIcons *decoders* (steffest/Amiga-Icon-converter, ImageMagick's
 * wbinfo coder) match on the "IM1="/"IM2=" prefix alone and ignore the marker, so a
 * round-trip through them cannot catch its absence. AmigaOS itself is stricter.
 */
const NEWICONS_PREAMBLE = [' ', "*** DON'T EDIT THE FOLLOWING LINES!! ***"];

const ICON_TYPE_CODES: Record<IconKind, number> = {
  disk: 1,
  drawer: 2,
  tool: 3,
  project: 4,
  trashcan: 5,
};

export function buildInfoFile(params: {
  width: number;
  height: number;
  kind: IconKind;
  normal: NewIconState;
  selected: NewIconState;
  /**
   * The program Workbench runs when this icon is double-clicked (`do_DefaultTool`).
   *
   * Set by the archive's own "Install kde2amiga Icons" icon, to `Installer`, and by any
   * converted icon that targets a Workbench entry whose original carries a default
   * tool (a project icon such as `SYS:System/Shell` has nothing to run without one).
   * Icons that only stand next to a file, or that only fill a `def_` slot, leave it
   * unset — a DefaultTool they did not ask for would hijack the double-click.
   */
  defaultTool?: string;
  /**
   * ToolTypes to carry into the icon, verbatim and in order, ahead of the NewIcons
   * payload.
   *
   * Load-bearing rather than decorative. A replacement for a WBStartup icon that drops
   * `DONOTWAIT` leaves Workbench blocking on that startup item, and a replacement for
   * `SYS:System/Shell` that drops `WINDOW=` opens a shell with no console. The values
   * come from `workbenchTargets`, which read them off a real 3.2.3 install.
   */
  toolTypes?: readonly string[];
}): Uint8Array {
  const { width, height, kind, normal, selected, defaultTool, toolTypes: carried } = params;

  const isDrawerLike = kind === 'drawer' || kind === 'trashcan';

  const toolTypes = [
    ...(carried ?? []),
    ...NEWICONS_PREAMBLE,
    ...encodeNewIconState(normal, 'IM1='),
    ...encodeNewIconState(selected, 'IM2='),
  ];

  const w = new BinaryWriter();

  // DiskObject header (78 bytes)
  w.writeWord(0xe310);
  w.writeWord(1); // version
  w.writeDWord(0); // nextGadget
  w.writeWord(0); // leftEdge
  w.writeWord(0); // topEdge
  w.writeWord(width);
  w.writeWord(height);
  w.writeWord(6); // flags
  w.writeWord(3); // activation
  w.writeWord(1); // gadgetType
  w.writeDWord(1); // gadgetRender
  w.writeDWord(1); // selectRender
  w.writeDWord(0); // gadgetText
  w.writeDWord(0); // mutualExclude
  w.writeDWord(0); // specialInfo
  w.writeWord(0); // gadgetID
  w.writeDWord(1); // userData
  w.writeUByte(ICON_TYPE_CODES[kind]);
  w.writeUByte(0); // padding
  w.writeDWord(defaultTool === undefined ? 0 : 1); // hasDefaultTool
  w.writeDWord(1); // hasToolTypes
  w.writeLong(128 << 24); // currentX
  w.writeLong(128 << 24); // currentY
  w.writeDWord(isDrawerLike ? 1 : 0); // hasDrawerData
  w.writeDWord(0); // hasToolWindow
  w.writeDWord(8192); // stackSize

  if (isDrawerLike) writeDrawerData(w);

  writeClassicImage(w, width, height, false);
  writeClassicImage(w, width, height, true);

  // do_DefaultTool's string sits between the images and the ToolTypes array. Writing it
  // anywhere else leaves a reader treating its length field as the ToolTypes count.
  if (defaultTool !== undefined) {
    w.writeDWord(defaultTool.length + 1);
    w.writeString(defaultTool);
    w.writeUByte(0);
  }

  // ToolTypes array
  w.writeDWord((toolTypes.length + 1) * 4);
  for (const toolType of toolTypes) {
    w.writeDWord(toolType.length + 1);
    w.writeString(toolType);
    w.writeUByte(0);
  }

  // OS2.x/3.x drawer tail (6 bytes): dd_Flags (LONG) + dd_ViewModes (UWORD).
  // Required whenever hasDrawerData && userData (userData = 1 for all icons we write).
  // Zeros mean DDFLAGS_SHOWDEFAULT / DDVM_BYDEFAULT, i.e. "use Workbench's defaults".
  if (isDrawerLike) {
    w.writeDWord(0); // dd_Flags
    w.writeWord(0); // dd_ViewModes
  }

  return w.toUint8Array();
}

/**
 * DrawerData (56 bytes): a NewWindow (48 bytes) followed by CurrentX/CurrentY (LONG each).
 * Written immediately after the 78-byte DiskObject header and before the images, for
 * do_Type 2 (drawer) and 5 (trashcan) icons only.
 */
function writeDrawerData(w: BinaryWriter): void {
  // NewWindow (48 bytes)
  w.writeWord(50); // LeftEdge
  w.writeWord(40); // TopEdge
  w.writeWord(400); // Width
  w.writeWord(150); // Height
  w.writeUByte(0xff); // DetailPen
  w.writeUByte(0xff); // BlockPen
  w.writeDWord(0); // IDCMPFlags
  w.writeDWord(0); // Flags
  w.writeDWord(0); // FirstGadget
  w.writeDWord(0); // CheckMark
  w.writeDWord(0); // Title
  w.writeDWord(0); // Screen
  w.writeDWord(0); // BitMap
  w.writeWord(0); // MinWidth
  w.writeWord(0); // MinHeight
  w.writeWord(0); // MaxWidth
  w.writeWord(0); // MaxHeight
  w.writeWord(0); // Type
  // CurrentX, CurrentY (LONG each)
  w.writeLong(0);
  w.writeLong(0);
}

function writeClassicImage(w: BinaryWriter, width: number, height: number, selected: boolean): void {
  w.writeWord(0); // leftEdge
  w.writeWord(0); // topEdge
  w.writeWord(width);
  w.writeWord(height);
  w.writeWord(1); // depth
  w.writeDWord(1); // hasImageData
  w.writeUByte(0); // planePick
  w.writeUByte(0); // planeOnOff
  w.writeDWord(0); // nextImage
  w.writeBytes(packClassicImageBitplane(width, height, selected));
}

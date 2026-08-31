import { BinaryWriter } from './binaryWriter';
import { packClassicImageBitplane } from './classicImage';
import { encodeNewIconState, type NewIconState } from './newIconsEncoder';

export type IconKind = 'disk' | 'drawer' | 'tool' | 'project' | 'trashcan';

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
}): Uint8Array {
  const { width, height, kind, normal, selected } = params;

  const isDrawerLike = kind === 'drawer' || kind === 'trashcan';

  const toolTypes = [
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
  w.writeDWord(0); // hasDefaultTool
  w.writeDWord(1); // hasToolTypes
  w.writeLong(128 << 24); // currentX
  w.writeLong(128 << 24); // currentY
  w.writeDWord(isDrawerLike ? 1 : 0); // hasDrawerData
  w.writeDWord(0); // hasToolWindow
  w.writeDWord(8192); // stackSize

  if (isDrawerLike) writeDrawerData(w);

  writeClassicImage(w, width, height, false);
  writeClassicImage(w, width, height, true);

  // ToolTypes array
  w.writeDWord((toolTypes.length + 1) * 4);
  for (const toolType of toolTypes) {
    w.writeDWord(toolType.length + 1);
    w.writeString(toolType);
    w.writeUByte(0);
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

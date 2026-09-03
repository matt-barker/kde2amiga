import type { IconKind } from '../newicons/diskObject';

/**
 * A slot in `ENVARC:Sys` that AmigaOS falls back to when a file or drawer has no icon
 * of its own, named for the `def_<role>.info` file that fills it.
 *
 * Deliberately NOT `IconKind` from ../newicons/diskObject: that type models the
 * DiskObject type byte, which has eight legal values, and only five of them are also
 * fallback slots. These two sets used to coincide, and forcing them to stay equal is
 * exactly what kept us down to five slots when the target machine has thirty-three.
 */
export type DefaultIconRole = (typeof DEFAULT_ICON_SLOTS)[number]['role'];

export interface DefaultIconSlot {
  /** The part after `def_`, cased exactly as the file appears in ENVARC:Sys. */
  role: string;
  /**
   * Which of the two fallback mechanisms consults this slot.
   *
   * `type` — icon.library, matching on the DiskObject type byte. Five slots, and the
   * only ones where the `def_` file's own type byte has to agree with its name.
   * `deficons` — DefIcons, matching on the file's *datatype*. The `def_` file is an
   * ordinary project icon; its type byte plays no part in the match.
   */
  group: 'type' | 'deficons';
  /** The DiskObject type the `def_<role>.info` copy should carry. */
  kind: IconKind;
  /** Short gloss for the UI: `def_i` and `def_rad` name nothing on their own. */
  description: string;
}

/**
 * Every slot we offer, in the order the UI lists them.
 *
 * The `deficons` half is not a guess at what AmigaOS defines in general — it is the
 * exact set of `def_*.info` files present in ENVARC:Sys on the target machine (A1200 /
 * OS 3.2.3), captured from a directory listing there and pinned by
 * `defaultIconSlots.test.ts`. Offering a slot the installed OS does not consult would
 * write a file nothing ever reads, which looks like success and is not.
 */
export const DEFAULT_ICON_SLOTS = [
  // icon.library's type-byte fallbacks.
  { role: 'drawer', group: 'type', kind: 'drawer', description: 'Drawers without their own icon' },
  { role: 'disk', group: 'type', kind: 'disk', description: 'Volumes without their own icon' },
  { role: 'tool', group: 'type', kind: 'tool', description: 'Executable programs' },
  { role: 'project', group: 'type', kind: 'project', description: 'Data files with no better match' },
  { role: 'trashcan', group: 'type', kind: 'trashcan', description: 'The Trashcan drawer' },

  // DefIcons' datatype fallbacks, all ordinary project icons.
  { role: 'adf', group: 'deficons', kind: 'project', description: 'Amiga floppy disk image' },
  { role: 'amigaguide', group: 'deficons', kind: 'project', description: 'AmigaGuide document' },
  { role: 'archive', group: 'deficons', kind: 'project', description: 'LhA / LZX / zip archive' },
  { role: 'ascii', group: 'deficons', kind: 'project', description: 'Plain text' },
  { role: 'asm', group: 'deficons', kind: 'project', description: '68k assembler source' },
  { role: 'c', group: 'deficons', kind: 'project', description: 'C source' },
  { role: 'cd0', group: 'deficons', kind: 'project', description: 'CD-ROM volume' },
  { role: 'cpp', group: 'deficons', kind: 'project', description: 'C++ source' },
  { role: 'diskarchive', group: 'deficons', kind: 'project', description: 'DMS / disk-image archive' },
  { role: 'font', group: 'deficons', kind: 'project', description: 'Bitmap font' },
  { role: 'h', group: 'deficons', kind: 'project', description: 'C header' },
  { role: 'i', group: 'deficons', kind: 'project', description: 'Assembler include' },
  { role: 'iff', group: 'deficons', kind: 'project', description: 'IFF file' },
  { role: 'key', group: 'deficons', kind: 'project', description: 'Keyfile' },
  { role: 'kickstart', group: 'deficons', kind: 'project', description: 'Kickstart ROM image' },
  { role: 'mp3', group: 'deficons', kind: 'project', description: 'MP3 audio' },
  { role: 'music', group: 'deficons', kind: 'project', description: 'Music module' },
  { role: 'officedocs', group: 'deficons', kind: 'project', description: 'Office document' },
  { role: 'pdf', group: 'deficons', kind: 'project', description: 'PDF document' },
  { role: 'picture', group: 'deficons', kind: 'project', description: 'Picture' },
  { role: 'prefs', group: 'deficons', kind: 'project', description: 'Preferences file' },
  { role: 'rad', group: 'deficons', kind: 'project', description: 'Recoverable RAM disk' },
  { role: 'RAM', group: 'deficons', kind: 'project', description: 'RAM disk' },
  { role: 'rexx', group: 'deficons', kind: 'project', description: 'ARexx script' },
  { role: 'script', group: 'deficons', kind: 'project', description: 'AmigaDOS script' },
  { role: 'sound', group: 'deficons', kind: 'project', description: 'Sound sample' },
  { role: 'src', group: 'deficons', kind: 'project', description: 'Source file' },
  { role: 'video', group: 'deficons', kind: 'project', description: 'Video file' },
] as const satisfies readonly DefaultIconSlot[];

const BY_ROLE = new Map<string, DefaultIconSlot>(
  DEFAULT_ICON_SLOTS.map((slot) => [slot.role, slot]),
);

/**
 * Throws rather than returning undefined: every caller has a `DefaultIconRole` in hand
 * and would only have gone on to read `.kind` off nothing. A role that is not in the
 * catalogue means a stale persisted assignment, and failing loudly beats writing a
 * `def_undefined.info` into the archive.
 */
export function slotForRole(role: DefaultIconRole): DefaultIconSlot {
  const slot = BY_ROLE.get(role);
  if (!slot) throw new Error(`Not a default-icon slot: ${role}`);
  return slot;
}

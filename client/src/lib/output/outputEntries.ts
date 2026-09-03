/**
 * The five AmigaOS default-icon fallback slots (`ENVARC:Sys/def_*.info`).
 * Deliberately NOT `IconKind` from ../newicons/diskObject: that type models the
 * DiskObject type byte, which has eight legal values (device, kickstart and
 * appicon besides these five). The two sets coincide today but mean different
 * things, and widening IconKind must not widen this.
 */
export type DefaultIconRole = 'drawer' | 'disk' | 'tool' | 'project' | 'trashcan';

export interface ConvertedIcon {
  name: string;
  infoBytes: Uint8Array;
  role?: DefaultIconRole;
}

/**
 * The name both downloads are offered under, and the drawer everything sits in inside
 * them. One constant because the two must agree: `lha x` extracts into the current
 * directory, so the drawer is what stops an archive scattering itself, and a user who
 * unpacks `kde2amiga-icons.lha` expects a `kde2amiga-icons` drawer to appear.
 */
export const ARCHIVE_BASE_NAME = 'kde2amiga-icons';

/** One file in an output archive. Shaped to drop straight into either builder. */
export interface ArchiveEntry {
  path: string;
  bytes: Uint8Array;
}

const README_TEXT = `kde2amiga converted icons
==========================

Each <name>.info file can be copied next to its matching drawer/file on your
Amiga and used immediately.

If any icons here were tagged as system-wide defaults, they're under Sys/
(e.g. Sys/def_drawer.info). To make them take effect immediately, copy the
contents of Sys/ to BOTH of these locations:

  ENVARC:Sys/   (persists across reboots)
  ENV:Sys/      (the live copy Workbench and Directory Opus 5 read right now)

Copying to ENVARC:Sys/ alone will only take effect after your next reboot.
`;

/**
 * Encodes text as ISO-8859-1, which is what AmigaOS reads — not UTF-8.
 *
 * `TextEncoder` is avoided on both counts. It emits UTF-8, which would render any
 * non-ASCII character as mojibake on the target; and under jsdom it returns a
 * Uint8Array from a different realm, which JSZip's `instanceof` check rejects outright
 * with "Can't read the data of 'README.txt'".
 */
function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

/**
 * The file layout of an output archive, independent of how it gets packed.
 *
 * Everything is nested in a single drawer named for the archive. `lha x` and most unzip
 * tools extract into the current directory, so a flat archive drops hundreds of loose
 * `.info` files into whatever drawer the user was sitting in.
 *
 * Kept out of both the zip and the LHA builder on purpose: the two formats have to
 * offer byte-for-byte the same files, and a layout each one worked out separately is
 * exactly the sort of thing that drifts once only one of them is touched.
 */
export function buildOutputEntries(
  icons: ConvertedIcon[],
  rootName: string = ARCHIVE_BASE_NAME,
): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  const at = (path: string) => `${rootName}/${path}`;

  for (const icon of icons) {
    entries.push({ path: at(`${icon.name}.info`), bytes: icon.infoBytes });
    if (icon.role) {
      entries.push({ path: at(`Sys/def_${icon.role}.info`), bytes: icon.infoBytes });
    }
  }

  entries.push({ path: at('README.txt'), bytes: encodeLatin1(README_TEXT) });
  return entries;
}

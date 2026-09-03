import { buildInstallerIcon } from './installerIcon';
import {
  INSTALLER_SCRIPT,
  INSTALLER_SCRIPT_NAME,
  SYS_DRAWER,
} from './installerScript';

import type { DefaultIconRole } from './defaultIconSlots';

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

/**
 * Written per archive rather than as one constant: an archive with nothing tagged as a
 * default carries no `Sys/` drawer and no installer, and a README telling that user to
 * double-click a file that is not there is worse than no README at all.
 */
function readmeText(hasDefaults: boolean): string {
  const intro = `kde2amiga converted icons
==========================

Each <name>.info file can be copied next to its matching drawer/file on your
Amiga and used immediately.
`;

  if (!hasDefaults) return intro;

  return `${intro}
The icons you tagged as system-wide defaults are under ${SYS_DRAWER}/ (for example
${SYS_DRAWER}/def_drawer.info). To install them, double-click "${INSTALLER_SCRIPT_NAME}"
in this drawer, or run it from a Shell:

  execute "${INSTALLER_SCRIPT_NAME}"

It copies them into BOTH of these locations:

  ENVARC:Sys/   (persists across reboots)
  ENV:Sys/      (the live copy Workbench and Directory Opus 5 read right now)

Copying to ENVARC:Sys/ alone would only take effect after your next reboot.
Icons already drawn on screen keep their old look until then either way.
`;
}

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
      entries.push({ path: at(`${SYS_DRAWER}/def_${icon.role}.info`), bytes: icon.infoBytes });
    }
  }

  /*
   * The installer only ships alongside something to install. On an archive with no
   * tagged defaults it would copy an absent drawer and still report success, which
   * is a worse answer than not offering it.
   */
  const hasDefaults = icons.some((icon) => icon.role !== undefined);
  if (hasDefaults) {
    entries.push({ path: at(INSTALLER_SCRIPT_NAME), bytes: encodeLatin1(INSTALLER_SCRIPT) });
    entries.push({ path: at(`${INSTALLER_SCRIPT_NAME}.info`), bytes: buildInstallerIcon() });
  }

  entries.push({ path: at('README.txt'), bytes: encodeLatin1(readmeText(hasDefaults)) });
  return entries;
}

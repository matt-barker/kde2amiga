import { buildInstallerIcon } from './installerIcon';
import type { InstallerFiles } from './installerBinary';
import {
  BACKUP_DEFAULT_DIR,
  BACKUP_DRAWER,
  ENVARC_BACKUP_BRANCH,
  ENVARC_SYS,
  INSTALLER_BINARY_NAME,
  INSTALLER_DRAWER,
  INSTALLER_LICENSE_NAME,
  INSTALLER_SCRIPT_NAME,
  SYS_DRAWER,
  buildInstallerScript,
} from './installerScript';
import { buildInfoFile, type IconKind } from '../newicons/diskObject';
import type { NewIconState } from '../newicons/newIconsEncoder';
import { slotForRole, type DefaultIconRole } from './defaultIconSlots';
import {
  WB_DRAWER,
  archiveDrawerFor,
  targetForPath,
  targetsByDrawer,
  type WorkbenchTargetPath,
} from './workbenchTargets';

/**
 * One converted icon, as image states rather than as a finished `.info`.
 *
 * It used to carry finished bytes, which meant every destination got the same type byte.
 * That held while there were two destinations that happened to agree; it stopped holding
 * the moment an icon could be both `def_picture` (a project icon, by DefIcons' rules) and
 * `SYS:Prefs/Font` (a tool, because Workbench must *run* what it names). Carrying states
 * lets each destination stamp its own type byte and its own metadata, and costs one extra
 * `buildInfoFile` call — nothing next to rasterising and quantising the icon.
 */
export interface ConvertedIcon {
  name: string;
  width: number;
  height: number;
  /** The type byte for the standalone `<name>.info` only. */
  kind: IconKind;
  normal: NewIconState;
  selected: NewIconState;
  role?: DefaultIconRole;
  /**
   * The Workbench icon this also replaces, as a `SYS:Prefs/Font` path.
   *
   * Independent of both `kind` and `role`: the copy is named for the target, typed for
   * the target, and carries the target's own default tool and ToolTypes, none of which
   * the other two destinations know or care about.
   */
  target?: WorkbenchTargetPath;
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
 * default carries no `Sys/` drawer and one with no targets carries no `Wb/` drawer, and
 * a README telling that user to open a drawer that is not there — or to double-click an
 * installer that was not shipped — is worse than no README at all. `hasInstaller` is the
 * same argument one level down: the Shell command names `C/Installer` only when that
 * file is in the archive.
 */
function readmeText(options: {
  hasDefaults: boolean;
  hasTargets: boolean;
  hasInstaller: boolean;
}): string {
  const { hasDefaults, hasTargets, hasInstaller } = options;
  const backupRoot = `${BACKUP_DEFAULT_DIR}/${BACKUP_DRAWER}`;
  const envarcBackup = `${backupRoot}/${ENVARC_BACKUP_BRANCH.join('/')}`;

  let text = `kde2amiga converted icons
==========================

Each <name>.info file can be copied next to its matching drawer/file on your
Amiga and used immediately.
`;

  if (hasDefaults) {
    text += `
The icons you tagged as system-wide defaults are under ${SYS_DRAWER}/ (for example
${SYS_DRAWER}/def_drawer.info). The installer copies them into BOTH of these
locations:

  ${ENVARC_SYS}/   (persists across reboots)
  ENV:Sys/      (the live copy Workbench and Directory Opus 5 read right now)

Copying to ${ENVARC_SYS}/ alone would only take effect after your next reboot.
Icons already drawn on screen keep their old look until then either way.
`;
  }

  if (hasTargets) {
    text += `
The icons you assigned to Workbench locations are under ${WB_DRAWER}/, laid out the
same way your Amiga is - ${WB_DRAWER}/SYS/Prefs/Font.info replaces SYS:Prefs/Font.info.
`;
  }

  if (hasDefaults || hasTargets) {
    text += `
Backups
-------

The installer copies each original into a backup drawer before replacing it. That
drawer is wherever you point the installer, with ${BACKUP_DRAWER}/ below it and the
tree each icon came from mirrored below that. Take the default the installer
offers and the originals end up as follows.
`;

    // Both halves overwrite icons the machine already had, so both name a concrete
    // path and a Copy line. "Copied into a backup drawer" is not a restore procedure,
    // and this README is read on a machine with no text search after an install went
    // wrong - the exact path is the whole value of the section.
    if (hasDefaults) {
      text += `
Any def_ icons you already had in ${ENVARC_SYS} are kept under:

  ${envarcBackup}/

To put them back, from a Shell:

  Copy ${envarcBackup}/#?.info TO ${ENVARC_SYS}

Then reboot, or copy the same files into ENV:Sys as well to see it straight away.
`;
    }

    if (hasTargets) {
      text += `
Each replaced Workbench icon is kept under the same tree, so the original
SYS:Prefs/Font.info ends up as:

  ${backupRoot}/SYS/Prefs/Font.info

To put a whole drawer's originals back, from a Shell:

  Copy ${backupRoot}/SYS/Prefs/#?.info TO SYS:Prefs
`;
    }

    text += `
Installing a second time will not overwrite a backup that is already there, so the
originals stay the originals however many themes you try.
`;
  }

  if (hasTargets) {
    text += `
One thing the backup exists for: a replaced icon loses its position in the drawer,
and a replaced drawer loses its window size and position, because nothing in this
archive can read those out of the icon it is replacing. Re-arrange the drawer and
use Icons/Snapshot once you are happy with it.
`;
  }

  if (hasDefaults || hasTargets) {
    // The Shell line has to name the copy that is actually here. `Installer` alone
    // reaches whatever is on the command path, which on a machine with none is nothing
    // at all - the reason the binary travels with the archive in the first place.
    const shellCommand = hasInstaller
      ? `${INSTALLER_DRAWER}/${INSTALLER_BINARY_NAME}`
      : INSTALLER_BINARY_NAME;

    text += `
To install, double-click "${INSTALLER_SCRIPT_NAME}" in this drawer, or run it
from a Shell in this drawer:

  ${shellCommand} "${INSTALLER_SCRIPT_NAME}"
`;

    if (hasInstaller) {
      text += `
The ${INSTALLER_BINARY_NAME} program itself is in ${INSTALLER_DRAWER}/ with its licence, so you do
not need one installed already. It is not the thing to double-click - the script
above is.
`;
    }

    text += `
Installer and Installer project icon
(c) Copyright 1995-96 Escom AG.  All Rights Reserved.
Reproduced and distributed under license from Escom AG.

INSTALLER SOFTWARE IS PROVIDED "AS-IS" AND SUBJECT TO CHANGE; NO WARRANTIES
ARE MADE.  ALL USE IS AT YOUR OWN RISK.  NO LIABILITY OR RESPONSIBILITY IS
ASSUMED.
`;
  }

  return text;
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
 * Builds one destination's `.info` from an icon's states.
 *
 * Every `.info` the archive contains goes through here, so there is exactly one place
 * that decides what a destination's type byte and metadata are.
 */
function infoFor(
  icon: ConvertedIcon,
  kind: IconKind,
  metadata: { defaultTool?: string; toolTypes?: readonly string[] } = {},
): Uint8Array {
  return buildInfoFile({
    width: icon.width,
    height: icon.height,
    kind,
    normal: icon.normal,
    selected: icon.selected,
    defaultTool: metadata.defaultTool,
    toolTypes: metadata.toolTypes,
  });
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
export interface OutputOptions {
  /** The drawer everything nests in; also the download's filename. */
  rootName?: string;
  /**
   * The bundled Installer, or undefined to leave it out.
   *
   * Optional so the layout stays a pure function testable with a stub — the real bytes
   * arrive over the network, and threading a fetch through here would make every layout
   * test asynchronous for no gain.
   */
  installer?: InstallerFiles;
}

export function buildOutputEntries(
  icons: ConvertedIcon[],
  options: OutputOptions = {},
): ArchiveEntry[] {
  const rootName = options.rootName ?? ARCHIVE_BASE_NAME;
  const entries: ArchiveEntry[] = [];
  const at = (path: string) => `${rootName}/${path}`;

  for (const icon of icons) {
    entries.push({ path: at(`${icon.name}.info`), bytes: infoFor(icon, icon.kind) });
    if (icon.role) {
      entries.push({
        path: at(`${SYS_DRAWER}/def_${icon.role}.info`),
        bytes: infoFor(icon, slotForRole(icon.role).kind),
      });
    }
    if (icon.target) {
      const target = targetForPath(icon.target);
      entries.push({
        path: at(`${archiveDrawerFor(target)}/${target.name}.info`),
        bytes: infoFor(icon, target.kind, {
          defaultTool: target.defaultTool,
          toolTypes: target.toolTypes,
        }),
      });
    }
  }

  const hasDefaults = icons.some((icon) => icon.role !== undefined);
  const drawers = targetsByDrawer(
    icons.flatMap((icon) => (icon.target ? [icon.target] : [])),
  );

  /*
   * The installer only ships alongside something to install. On an archive with neither
   * defaults nor targets it would copy absent drawers and still report success, which is
   * a worse answer than not offering it.
   */
  if (hasDefaults || drawers.size > 0) {
    const script = buildInstallerScript({ hasDefaults, drawers });
    entries.push({ path: at(INSTALLER_SCRIPT_NAME), bytes: encodeLatin1(script) });
    entries.push({ path: at(`${INSTALLER_SCRIPT_NAME}.info`), bytes: buildInstallerIcon() });

    /*
     * Below `C/` rather than beside the script. In the root the two files a user meets
     * are the script and `Installer`, and the executable is the one that looks like the
     * thing to run. The script icon's default tool follows it there — the two paths are
     * built from `INSTALLER_DRAWER` so they cannot part company.
     */
    if (options.installer) {
      const inDrawer = (name: string) => at(`${INSTALLER_DRAWER}/${name}`);
      entries.push({ path: inDrawer(INSTALLER_BINARY_NAME), bytes: options.installer.binary });
      entries.push({ path: inDrawer(INSTALLER_LICENSE_NAME), bytes: options.installer.license });
    }
  }

  entries.push({
    path: at('README.txt'),
    bytes: encodeLatin1(
      readmeText({
        hasDefaults,
        hasTargets: drawers.size > 0,
        hasInstaller: options.installer !== undefined,
      }),
    ),
  });
  return entries;
}

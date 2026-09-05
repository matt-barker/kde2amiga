import { describe, it, expect } from 'vitest';
import { buildOutputEntries, ARCHIVE_BASE_NAME } from './outputEntries';
import {
  INSTALLER_DEFAULT_TOOL,
  INSTALLER_DRAWER,
  INSTALLER_SCRIPT_NAME,
} from './installerScript';
import { decodeInfoFileForTest } from '../newicons/diskObjectDecoderForTest';

import type { NewIconState } from '../newicons/newIconsEncoder';
import type { ConvertedIcon } from './outputEntries';

const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/**
 * A minimal icon in the shape `buildOutputEntries` now takes. The states matter only
 * in that they decode; every assertion here is about which type byte and metadata each
 * destination gets, not about pixels.
 */
function state(): NewIconState {
  return {
    width: 2,
    height: 2,
    transparent: true,
    palette: [[0, 0, 0], [255, 255, 255]],
    pixels: [0, 1, 1, 0],
  };
}

function icon(overrides: Partial<ConvertedIcon> = {}): ConvertedIcon {
  return {
    name: 'folder',
    width: 2,
    height: 2,
    kind: 'drawer',
    normal: state(),
    selected: state(),
    ...overrides,
  };
}

const pathsOf = (
  icons: Parameters<typeof buildOutputEntries>[0],
  rootName?: string,
) => buildOutputEntries(icons, rootName ? { rootName } : undefined).map((entry) => entry.path);

const installer = {
  binary: new Uint8Array([0x00, 0x00, 0x03, 0xf3]),
  license: new Uint8Array([0x4c, 0x49, 0x43]),
};

/**
 * The layout both archive formats share. It lives apart from either builder so the zip
 * and the LHA cannot drift into offering different files — the same reason `prepareIcon`
 * owns the steps that preview and conversion both need.
 */
describe('buildOutputEntries', () => {
  it('places every icon as <name>.info inside the archive drawer', () => {
    expect(
      pathsOf([
        icon({ name: 'folder' }),
        icon({ name: 'firefox' }),
      ]),
    ).toEqual(
      expect.arrayContaining([
        `${ARCHIVE_BASE_NAME}/folder.info`,
        `${ARCHIVE_BASE_NAME}/firefox.info`,
      ]),
    );
  });

  it('additionally places a role-tagged icon under Sys/def_<role>.info', () => {
    const paths = pathsOf([icon({ role: 'drawer' })]);
    expect(paths).toEqual(
      expect.arrayContaining([
        `${ARCHIVE_BASE_NAME}/folder.info`,
        `${ARCHIVE_BASE_NAME}/Sys/def_drawer.info`,
      ]),
    );
  });

  /**
   * The standalone icon and the def_ copy no longer share bytes, and must not: DefIcons
   * applies the slot icon's type to the file it matches, so a tool-typed def_picture
   * would have Workbench try to *execute* every picture on the machine.
   */
  it('stamps each destination with its own type byte', () => {
    const entries = buildOutputEntries([icon({ kind: 'drawer', role: 'picture' })]);

    const standalone = entries.find((e) => e.path.endsWith('/folder.info'));
    const slot = entries.find((e) => e.path.endsWith('/Sys/def_picture.info'));

    expect(decodeInfoFileForTest(standalone!.bytes).type).toBe(2); // drawer
    expect(decodeInfoFileForTest(slot!.bytes).type).toBe(4); // project, per the slot
  });

  /**
   * A volume slot has to come out of the whole pipeline as a disk icon, not merely be
   * catalogued as one. Shipped as a project, def_RAM.info made the RAM disk unopenable
   * on the A1200: "Please insert volume RAM Disk in any drive".
   *
   * Checked against the real GlowIcons set in ENVARC:Sys on the target machine, where
   * def_ram, def_rad and def_cd0 all carry type 1 with DrawerData, and def_adf — a disk
   * *image*, which is a file — carries type 4.
   */
  it('writes a volume slot as a disk icon, with the DrawerData that opens its window', () => {
    for (const role of ['RAM', 'rad', 'cd0'] as const) {
      const entries = buildOutputEntries([icon({ kind: 'project', role })]);
      const slot = entries.find((e) => e.path.endsWith(`/Sys/def_${role}.info`))!;

      expect(decodeInfoFileForTest(slot.bytes).type).toBe(1);
      // do_DrawerData, the DWORD at offset 66: a disk icon promising a window must
      // actually carry the structure that describes it.
      const view = new DataView(slot.bytes.buffer, slot.bytes.byteOffset);
      expect(view.getUint32(66)).not.toBe(0);
    }
  });

  it('gives a type-fallback slot the type its own name demands', () => {
    const entries = buildOutputEntries([icon({ kind: 'project', role: 'trashcan' })]);
    const slot = entries.find((e) => e.path.endsWith('/Sys/def_trashcan.info'));

    expect(decodeInfoFileForTest(slot!.bytes).type).toBe(5);
  });

  it('draws the same picture into every destination', () => {
    const entries = buildOutputEntries([icon({ role: 'drawer' })]);
    const standalone = decodeInfoFileForTest(
      entries.find((e) => e.path.endsWith('/folder.info'))!.bytes,
    );
    const slot = decodeInfoFileForTest(
      entries.find((e) => e.path.endsWith('/Sys/def_drawer.info'))!.bytes,
    );

    expect(slot.normal.pixels).toEqual(standalone.normal.pixels);
    expect(slot.selected.pixels).toEqual(standalone.selected.pixels);
  });

  const readmeFor = (icons: Parameters<typeof buildOutputEntries>[0]) =>
    textOf(
      buildOutputEntries(icons).find((entry) => entry.path === `${ARCHIVE_BASE_NAME}/README.txt`)!
        .bytes,
    );

  it('includes a README explaining how to install the Sys/ contents', () => {
    const readme = readmeFor([icon({ role: 'drawer' })]);
    expect(readme).toMatch(/ENVARC:Sys/);
    expect(readme).toMatch(/ENV:Sys/);
  });

  /**
   * An archive where nothing was tagged has no Sys/ drawer, so instructions for copying
   * one describe a file the user cannot find and cast doubt on the rest of the README.
   */
  it('leaves the Sys/ instructions out when there is no Sys/ drawer', () => {
    const readme = readmeFor([icon()]);
    expect(readme).not.toMatch(/ENVARC:Sys/);
    expect(readme).toMatch(/\.info/);
  });

  /**
   * Without this the user is left with a Wb/ tree, no word on what it is, and an
   * installer whose second option appears from nowhere.
   */
  it('describes the Wb/ tree in the README when a target was assigned', () => {
    const readme = readmeFor([icon({ target: 'SYS:Prefs/Font' })]);
    expect(readme).toMatch(/Wb\//);
    expect(readme).toMatch(/backup/);
  });

  /**
   * This README is what someone opens when the install went wrong, on a machine with no
   * text search and no memory of which drawer they picked in the askdir. "Copied into a
   * backup drawer" is not a restore procedure; a path and a Copy line are.
   */
  it('names where the backup went and how to put a drawer back', () => {
    const readme = readmeFor([icon({ target: 'SYS:Prefs/Font' })]);

    expect(readme).toContain('SYS:Storage/kde2amiga-backup/SYS/Prefs/Font.info');
    expect(readme).toContain(
      'Copy SYS:Storage/kde2amiga-backup/SYS/Prefs/#?.info TO SYS:Prefs',
    );
  });

  /**
   * The defaults half backs up too now, and a restore path is worth nothing unwritten:
   * this README is what someone opens after an install went wrong, on a machine with no
   * text search and no memory of which drawer they picked in the askdir.
   */
  it('names the ENVARC:Sys restore path when defaults are being installed', () => {
    const readme = readmeFor([icon({ role: 'drawer' })]);

    expect(readme).toContain('SYS:Storage/kde2amiga-backup/ENVARC/Sys/');
    expect(readme).toContain(
      'Copy SYS:Storage/kde2amiga-backup/ENVARC/Sys/#?.info TO ENVARC:Sys',
    );
  });

  /**
   * ENVARC: is what the script backs up, so ENVARC: is what the README can promise. A
   * restore that stops there leaves the RAM copy in ENV: still holding our icons until
   * the next boot rebuilds it, which looks exactly like a restore that did not work.
   */
  it('says a defaults restore needs a reboot, or ENV:Sys copying too', () => {
    const readme = readmeFor([icon({ role: 'drawer' })]);
    expect(readme).toMatch(/reboot, or copy the same files into ENV:Sys/);
  });

  /**
   * A pack with nothing to install ships no installer and takes no backups, so a
   * Backups heading would describe a drawer that never appears.
   */
  it('leaves the backup section out when nothing will be replaced', () => {
    expect(readmeFor([icon()])).not.toMatch(/Backups/);
  });

  /**
   * Nothing in the archive can carry an icon's saved position or a drawer's window
   * geometry across a replacement, so the only honest handling is to say so where the
   * user will read it.
   */
  it('says that replaced icons lose their positions and need Snapshotting', () => {
    const readme = readmeFor([icon({ target: 'SYS:Prefs/Font' })]);

    expect(readme).toMatch(/loses its position in the drawer/);
    expect(readme).toMatch(/window size and position/);
    expect(readme).toMatch(/Icons\/Snapshot/);
  });

  it('still includes the README when there are no icons at all', () => {
    expect(pathsOf([])).toEqual([`${ARCHIVE_BASE_NAME}/README.txt`]);
  });

  it('writes the def_ copy under the slot name, not the icon kind, for a DefIcons slot', () => {
    expect(pathsOf([icon({ name: 'gwenview', role: 'picture' })])).toEqual(
      expect.arrayContaining([`${ARCHIVE_BASE_NAME}/Sys/def_picture.info`]),
    );
  });

  it('keeps the exact casing of a slot that shipped capitalised', () => {
    expect(pathsOf([icon({ name: 'ram', role: 'RAM' })])).toEqual(
      expect.arrayContaining([`${ARCHIVE_BASE_NAME}/Sys/def_RAM.info`]),
    );
  });


  /**
   * `lha x foo.lha` and most unzip tools extract into the *current* directory, so a flat
   * archive scatters hundreds of .info files across whatever drawer the user happened to
   * be in. Everything therefore sits under one drawer named for the archive itself.
   */
  it('puts every single entry inside the drawer, with nothing loose at the root', () => {
    const paths = pathsOf([
      icon({ name: 'folder', role: 'drawer' }),
      icon({ name: 'trash', role: 'trashcan' }),
    ]);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(path.startsWith(`${ARCHIVE_BASE_NAME}/`)).toBe(true);
  });

  /**
   * The drawer is named after the archive rather than a constant of its own, so renaming
   * the download renames the drawer with it and the two can never disagree.
   */
  it('names the drawer after whatever the archive is called', () => {
    expect(pathsOf([icon()], 'amiga-goodies')).toEqual(
      expect.arrayContaining(['amiga-goodies/folder.info', 'amiga-goodies/README.txt']),
    );
  });

  it('leaves no entry outside a renamed drawer either', () => {
    for (const path of pathsOf([icon({ name: 'f', role: 'disk' })], 'x')) {
      expect(path.startsWith('x/')).toBe(true);
    }
  });
});

/**
 * The archive carries its own installer so the user does not have to retype a pile of
 * Copy commands into a Shell on a machine with no clipboard from the desktop.
 */
describe('the installer script', () => {
  const withRole = [icon({ role: 'drawer' })];

  it('ships the script and its icon beside the Sys drawer', () => {
    const paths = pathsOf(withRole);
    expect(paths).toEqual(
      expect.arrayContaining([
        `${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}`,
        `${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}.info`,
      ]),
    );
  });

  /**
   * The default tool is a path relative to the drawer the icon sits in, so it is only
   * correct in terms of where the layout actually put the binary. Asserted against the
   * shipped entry rather than against the constant on both sides, because moving the
   * binary and forgetting the icon gives Workbench "Installer not found" on hardware and
   * nothing at all here.
   */
  it('points the icon default tool at the Installer the archive actually ships', () => {
    const entries = buildOutputEntries(withRole, { installer });
    const scriptIcon = entries.find(
      (entry) => entry.path === `${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}.info`,
    );
    const defaultTool = decodeInfoFileForTest(scriptIcon!.bytes).defaultTool;

    expect(defaultTool).toBe(INSTALLER_DEFAULT_TOOL);
    expect(entries.map((entry) => entry.path)).toContain(
      `${ARCHIVE_BASE_NAME}/${defaultTool}`,
    );
  });

  it('writes the script as bytes AmigaDOS can read', () => {
    const script = buildOutputEntries(withRole).find(
      (entry) => entry.path === `${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}`,
    );
    expect(textOf(script!.bytes)).toContain('(copyfiles (source "Sys") (dest "ENVARC:Sys")');
  });

  /**
   * An installer next to an empty Sys drawer would report success having copied nothing.
   * If no icon claims a slot there is no Sys drawer at all, so the installer goes too.
   */
  it('is left out entirely when no icon claims a default slot', () => {
    const paths = pathsOf([icon()]);
    expect(paths).not.toContain(`${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}`);
    expect(paths).not.toContain(`${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}.info`);
  });

  /**
   * A pack of nothing but Workbench replacements still has something to install, and the
   * installer is the only thing that makes the backups before overwriting.
   */
  it('still ships when only Workbench targets were assigned', () => {
    const paths = pathsOf([icon({ target: 'SYS:Prefs/Font' })]);
    expect(paths).toContain(`${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}`);
  });

  it('points the README at the installer instead of only listing the Copy commands', () => {
    const readme = buildOutputEntries(withRole).find(
      (entry) => entry.path === `${ARCHIVE_BASE_NAME}/README.txt`,
    );
    expect(textOf(readme!.bytes)).toContain(INSTALLER_SCRIPT_NAME);
  });

  /**
   * The Shell line has to name the copy that is in the archive. `Installer` on its own
   * reaches whatever is on the command path, which on a machine with none is nothing —
   * the very reason the binary travels with the download.
   */
  it('gives the Shell command as C/Installer when the binary ships', () => {
    const readme = buildOutputEntries(withRole, { installer }).find((e) =>
      e.path.endsWith('README.txt'),
    );
    expect(textOf(readme!.bytes)).toContain(
      `${INSTALLER_DRAWER}/Installer "${INSTALLER_SCRIPT_NAME}"`,
    );
  });

  /**
   * And not when it does not: an archive built without the binary has no C/ drawer, so
   * pointing a Shell at C/Installer would fail where a bare Installer might still work.
   */
  it('falls back to a bare Installer in the README when none is bundled', () => {
    const readme = buildOutputEntries(withRole).find((e) => e.path.endsWith('README.txt'));
    const text = textOf(readme!.bytes);

    expect(text).toContain(`Installer "${INSTALLER_SCRIPT_NAME}"`);
    expect(text).not.toContain(`${INSTALLER_DRAWER}/Installer`);
  });

  it('sits inside the archive drawer like everything else', () => {
    for (const path of pathsOf(withRole)) {
      expect(path.startsWith(`${ARCHIVE_BASE_NAME}/`)).toBe(true);
    }
  });

  /**
   * In `C/`, not the root. Beside the script, the two things a user meets on opening the
   * drawer are `Install kde2amiga Icons` and `Installer`, and the second reads like the
   * one to double-click — it is a bare 68k executable that does nothing on its own.
   */
  it('ships the Installer and its licence in the C drawer, not the archive root', () => {
    const paths = buildOutputEntries([icon({ role: 'drawer' })], { installer }).map((e) => e.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        `${ARCHIVE_BASE_NAME}/${INSTALLER_DRAWER}/Installer`,
        `${ARCHIVE_BASE_NAME}/${INSTALLER_DRAWER}/Installer.license`,
      ]),
    );
    expect(paths).not.toContain(`${ARCHIVE_BASE_NAME}/Installer`);
    expect(paths).not.toContain(`${ARCHIVE_BASE_NAME}/Installer.license`);
  });

  it('copies the Installer binary through byte for byte', () => {
    const entry = buildOutputEntries([icon({ role: 'drawer' })], { installer }).find(
      (e) => e.path.endsWith('/Installer'),
    );
    expect(entry!.bytes).toEqual(installer.binary);
  });

  /**
   * Nothing to install means no script, so shipping a 110KB executable with it would be
   * 110KB of nothing.
   */
  it('ships no Installer when there is nothing to install', () => {
    const paths = buildOutputEntries([icon()], { installer }).map((e) => e.path);
    expect(paths.some((path) => path.endsWith('/Installer'))).toBe(false);
  });

  it('carries the Escom copyright notice and disclaimer in the README', () => {
    const readme = buildOutputEntries([icon({ role: 'drawer' })], { installer }).find((e) =>
      e.path.endsWith('README.txt'),
    );
    const text = textOf(readme!.bytes);

    expect(text).toContain('(c) Copyright 1995-96 Escom AG.  All Rights Reserved.');
    expect(text).toContain('Reproduced and distributed under license from Escom AG.');
    expect(text).toContain('INSTALLER SOFTWARE IS PROVIDED "AS-IS"');
  });
});

/**
 * A converted icon can also name a Workbench icon it replaces. That copy is mirrored
 * under Wb/ so the archive layout matches where the installer script has to put it.
 */
describe('Workbench target replacement', () => {
  it('mirrors the Workbench tree under Wb/, so the drawer names match the machine', () => {
    const paths = pathsOf([icon({ name: 'font', target: 'SYS:Prefs/Font' })]);

    expect(paths).toEqual(
      expect.arrayContaining([
        `${ARCHIVE_BASE_NAME}/font.info`,
        `${ARCHIVE_BASE_NAME}/Wb/SYS/Prefs/Font.info`,
      ]),
    );
  });

  /**
   * The target copy is named for the *target*, not for the KDE icon: Workbench pairs
   * `Font` with `Font.info`, so a copy called `font.info` would sit in SYS:Prefs doing
   * nothing at all.
   */
  it('names the target copy after the file it replaces', () => {
    const paths = pathsOf([icon({ name: 'preferences-desktop-font', target: 'SYS:Prefs/Font' })]);
    expect(paths).toContain(`${ARCHIVE_BASE_NAME}/Wb/SYS/Prefs/Font.info`);
  });

  /**
   * Losing the default tool here does not degrade the Shell icon, it disables it —
   * there is no `Shell` executable for Workbench to fall back on.
   */
  it('carries the target default tool and ToolTypes into the replacement', () => {
    const entries = buildOutputEntries([icon({ name: 'terminal', target: 'SYS:System/Shell' })]);
    const decoded = decodeInfoFileForTest(
      entries.find((e) => e.path.endsWith('/Wb/SYS/System/Shell.info'))!.bytes,
    );

    expect(decoded.type).toBe(4); // project, as the real Shell.info is
    expect(decoded.defaultTool).toBe('SYS:System/CLI');
    expect(decoded.toolTypes.slice(0, 3)).toEqual([
      'WINDOW=CON:0///130/AmigaShell/CLOSE/ICONIFY',
      'STACK=4096',
      'FROM=S:Shell-Startup',
    ]);
  });

  it('keeps DONOTWAIT on a WBStartup replacement', () => {
    const entries = buildOutputEntries([icon({ target: 'SYS:WBStartup/DefIcons' })]);
    const decoded = decodeInfoFileForTest(
      entries.find((e) => e.path.endsWith('/Wb/SYS/WBStartup/DefIcons.info'))!.bytes,
    );

    expect(decoded.toolTypes).toContain('DONOTWAIT');
  });

  /**
   * The three destinations disagree about the type byte on purpose, and this is the case
   * that proves it: one icon, standalone as a drawer, as def_picture a project, and in
   * SYS:Prefs a tool Workbench must be able to run.
   */
  it('lets one icon fill a slot and a target with different types', () => {
    const entries = buildOutputEntries([
      icon({ kind: 'drawer', role: 'picture', target: 'SYS:Prefs/Font' }),
    ]);
    const typeAt = (suffix: string) =>
      decodeInfoFileForTest(entries.find((e) => e.path.endsWith(suffix))!.bytes).type;

    expect(typeAt('/folder.info')).toBe(2); // drawer
    expect(typeAt('/Sys/def_picture.info')).toBe(4); // project
    expect(typeAt('/Wb/SYS/Prefs/Font.info')).toBe(3); // tool
  });

  it('writes no Wb drawer when nothing is assigned to a target', () => {
    const paths = pathsOf([icon({ role: 'drawer' })]);
    expect(paths.some((path) => path.includes('/Wb/'))).toBe(false);
  });
});

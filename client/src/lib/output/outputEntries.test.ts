import { describe, it, expect } from 'vitest';
import { buildOutputEntries, ARCHIVE_BASE_NAME } from './outputEntries';
import { INSTALLER_SCRIPT_NAME, INSTALLER_DEFAULT_TOOL } from './installerScript';
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

  it('gives the icon Installer as its default tool, which makes it double-clickable', () => {
    const icon = buildOutputEntries(withRole).find(
      (entry) => entry.path === `${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}.info`,
    );
    expect(decodeInfoFileForTest(icon!.bytes).defaultTool).toBe(INSTALLER_DEFAULT_TOOL);
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

  it('sits inside the archive drawer like everything else', () => {
    for (const path of pathsOf(withRole)) {
      expect(path.startsWith(`${ARCHIVE_BASE_NAME}/`)).toBe(true);
    }
  });

  it('ships the Installer and its licence beside the script', () => {
    const paths = buildOutputEntries([icon({ role: 'drawer' })], { installer }).map((e) => e.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        `${ARCHIVE_BASE_NAME}/Installer`,
        `${ARCHIVE_BASE_NAME}/Installer.license`,
      ]),
    );
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

import { describe, it, expect } from 'vitest';
import { buildOutputEntries, ARCHIVE_BASE_NAME } from './outputEntries';
import { INSTALLER_SCRIPT_NAME, INSTALLER_DEFAULT_TOOL } from './installerScript';
import { decodeInfoFileForTest } from '../newicons/diskObjectDecoderForTest';

const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const pathsOf = (
  icons: Parameters<typeof buildOutputEntries>[0],
  rootName?: string,
) => buildOutputEntries(icons, rootName).map((entry) => entry.path);

/**
 * The layout both archive formats share. It lives apart from either builder so the zip
 * and the LHA cannot drift into offering different files — the same reason `prepareIcon`
 * owns the steps that preview and conversion both need.
 */
describe('buildOutputEntries', () => {
  it('places every icon as <name>.info inside the archive drawer', () => {
    expect(
      pathsOf([
        { name: 'folder', infoBytes: new Uint8Array([1]) },
        { name: 'firefox', infoBytes: new Uint8Array([2]) },
      ]),
    ).toEqual(
      expect.arrayContaining([
        `${ARCHIVE_BASE_NAME}/folder.info`,
        `${ARCHIVE_BASE_NAME}/firefox.info`,
      ]),
    );
  });

  it('additionally places a role-tagged icon under Sys/def_<role>.info', () => {
    const paths = pathsOf([{ name: 'folder', infoBytes: new Uint8Array([1]), role: 'drawer' }]);
    expect(paths).toEqual(
      expect.arrayContaining([
        `${ARCHIVE_BASE_NAME}/folder.info`,
        `${ARCHIVE_BASE_NAME}/Sys/def_drawer.info`,
      ]),
    );
  });

  it('gives the role copy the same bytes as the icon it came from', () => {
    const infoBytes = new Uint8Array([9, 8, 7]);
    const entries = buildOutputEntries([{ name: 'folder', infoBytes, role: 'trashcan' }]);
    const role = entries.find(
      (entry) => entry.path === `${ARCHIVE_BASE_NAME}/Sys/def_trashcan.info`,
    );
    expect(role?.bytes).toEqual(infoBytes);
  });

  const readmeFor = (icons: Parameters<typeof buildOutputEntries>[0]) =>
    textOf(
      buildOutputEntries(icons).find((entry) => entry.path === `${ARCHIVE_BASE_NAME}/README.txt`)!
        .bytes,
    );

  it('includes a README explaining how to install the Sys/ contents', () => {
    const readme = readmeFor([{ name: 'folder', infoBytes: new Uint8Array([1]), role: 'drawer' }]);
    expect(readme).toMatch(/ENVARC:Sys/);
    expect(readme).toMatch(/ENV:Sys/);
  });

  /**
   * An archive where nothing was tagged has no Sys/ drawer, so instructions for copying
   * one describe a file the user cannot find and cast doubt on the rest of the README.
   */
  it('leaves the Sys/ instructions out when there is no Sys/ drawer', () => {
    const readme = readmeFor([{ name: 'folder', infoBytes: new Uint8Array([1]) }]);
    expect(readme).not.toMatch(/ENVARC:Sys/);
    expect(readme).toMatch(/\.info/);
  });

  it('still includes the README when there are no icons at all', () => {
    expect(pathsOf([])).toEqual([`${ARCHIVE_BASE_NAME}/README.txt`]);
  });

  it('writes the def_ copy under the slot name, not the icon kind, for a DefIcons slot', () => {
    expect(pathsOf([{ name: 'gwenview', infoBytes: new Uint8Array([1]), role: 'picture' }])).toEqual(
      expect.arrayContaining([`${ARCHIVE_BASE_NAME}/Sys/def_picture.info`]),
    );
  });

  it('keeps the exact casing of a slot that shipped capitalised', () => {
    expect(pathsOf([{ name: 'ram', infoBytes: new Uint8Array([1]), role: 'RAM' }])).toEqual(
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
      { name: 'folder', infoBytes: new Uint8Array([1]), role: 'drawer' },
      { name: 'trash', infoBytes: new Uint8Array([2]), role: 'trashcan' },
    ]);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(path.startsWith(`${ARCHIVE_BASE_NAME}/`)).toBe(true);
  });

  /**
   * The drawer is named after the archive rather than a constant of its own, so renaming
   * the download renames the drawer with it and the two can never disagree.
   */
  it('names the drawer after whatever the archive is called', () => {
    expect(pathsOf([{ name: 'folder', infoBytes: new Uint8Array([1]) }], 'amiga-goodies')).toEqual(
      expect.arrayContaining(['amiga-goodies/folder.info', 'amiga-goodies/README.txt']),
    );
  });

  it('leaves no entry outside a renamed drawer either', () => {
    for (const path of pathsOf([{ name: 'f', infoBytes: new Uint8Array([1]), role: 'disk' }], 'x')) {
      expect(path.startsWith('x/')).toBe(true);
    }
  });
});

/**
 * The archive carries its own installer so the user does not have to retype two Copy
 * commands into a Shell on a machine with no clipboard from the desktop.
 */
describe('the Install Default Icons installer', () => {
  const withRole = [{ name: 'folder', infoBytes: new Uint8Array([1]), role: 'drawer' as const }];

  it('ships the script and its icon beside the Sys drawer', () => {
    const paths = pathsOf(withRole);
    expect(paths).toEqual(
      expect.arrayContaining([
        `${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}`,
        `${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}.info`,
      ]),
    );
  });

  it('gives the icon IconX as its default tool, which is what makes it double-clickable', () => {
    const icon = buildOutputEntries(withRole).find(
      (entry) => entry.path === `${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}.info`,
    );
    expect(decodeInfoFileForTest(icon!.bytes).defaultTool).toBe(INSTALLER_DEFAULT_TOOL);
  });

  it('writes the script as bytes AmigaDOS can read', () => {
    const script = buildOutputEntries(withRole).find(
      (entry) => entry.path === `${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}`,
    );
    expect(textOf(script!.bytes)).toMatch(/Copy Sys\/#\?\.info TO ENVARC:Sys/);
  });

  /**
   * An installer next to an empty Sys drawer would report success having copied nothing.
   * If no icon claims a slot there is no Sys drawer at all, so the installer goes too.
   */
  it('is left out entirely when no icon claims a default slot', () => {
    const paths = pathsOf([{ name: 'folder', infoBytes: new Uint8Array([1]) }]);
    expect(paths).not.toContain(`${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}`);
    expect(paths).not.toContain(`${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}.info`);
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
});

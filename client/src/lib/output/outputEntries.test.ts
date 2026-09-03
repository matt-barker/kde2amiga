import { describe, it, expect } from 'vitest';
import { buildOutputEntries, ARCHIVE_BASE_NAME } from './outputEntries';

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

  it('includes a README explaining how to install the Sys/ contents', () => {
    const readme = buildOutputEntries([{ name: 'folder', infoBytes: new Uint8Array([1]) }]).find(
      (entry) => entry.path === `${ARCHIVE_BASE_NAME}/README.txt`,
    );
    expect(textOf(readme!.bytes)).toMatch(/ENVARC:Sys/);
    expect(textOf(readme!.bytes)).toMatch(/ENV:Sys/);
  });

  it('still includes the README when there are no icons at all', () => {
    expect(pathsOf([])).toEqual([`${ARCHIVE_BASE_NAME}/README.txt`]);
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

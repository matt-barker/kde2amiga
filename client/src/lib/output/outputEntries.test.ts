import { describe, it, expect } from 'vitest';
import { buildOutputEntries } from './outputEntries';

const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const pathsOf = (icons: Parameters<typeof buildOutputEntries>[0]) =>
  buildOutputEntries(icons).map((entry) => entry.path);

/**
 * The layout both archive formats share. It lives apart from either builder so the zip
 * and the LHA cannot drift into offering different files — the same reason `prepareIcon`
 * owns the steps that preview and conversion both need.
 */
describe('buildOutputEntries', () => {
  it('places every icon as <name>.info at the root', () => {
    expect(
      pathsOf([
        { name: 'folder', infoBytes: new Uint8Array([1]) },
        { name: 'firefox', infoBytes: new Uint8Array([2]) },
      ]),
    ).toEqual(expect.arrayContaining(['folder.info', 'firefox.info']));
  });

  it('additionally places a role-tagged icon under Sys/def_<role>.info', () => {
    const paths = pathsOf([{ name: 'folder', infoBytes: new Uint8Array([1]), role: 'drawer' }]);
    expect(paths).toEqual(expect.arrayContaining(['folder.info', 'Sys/def_drawer.info']));
  });

  it('gives the role copy the same bytes as the icon it came from', () => {
    const infoBytes = new Uint8Array([9, 8, 7]);
    const entries = buildOutputEntries([{ name: 'folder', infoBytes, role: 'trashcan' }]);
    const role = entries.find((entry) => entry.path === 'Sys/def_trashcan.info');
    expect(role?.bytes).toEqual(infoBytes);
  });

  it('includes a README explaining how to install the Sys/ contents', () => {
    const readme = buildOutputEntries([{ name: 'folder', infoBytes: new Uint8Array([1]) }]).find(
      (entry) => entry.path === 'README.txt',
    );
    expect(textOf(readme!.bytes)).toMatch(/ENVARC:Sys/);
    expect(textOf(readme!.bytes)).toMatch(/ENV:Sys/);
  });

  it('still includes the README when there are no icons at all', () => {
    expect(pathsOf([])).toEqual(['README.txt']);
  });
});

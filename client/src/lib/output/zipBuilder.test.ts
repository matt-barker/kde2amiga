import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildOutputZip } from './zipBuilder';
import { ARCHIVE_BASE_NAME } from './outputEntries';

import type { NewIconState } from '../newicons/newIconsEncoder';
import type { ConvertedIcon } from './outputEntries';

/** A minimal icon in the shape `buildOutputZip` now takes; only the paths are asserted here. */
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

describe('buildOutputZip', () => {
  it('places every icon as <name>.info inside the archive drawer', async () => {
    const blob = await buildOutputZip([
      icon({ name: 'folder' }),
      icon({ name: 'firefox' }),
    ]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file(`${ARCHIVE_BASE_NAME}/folder.info`)).not.toBeNull();
    expect(zip.file(`${ARCHIVE_BASE_NAME}/firefox.info`)).not.toBeNull();
  });

  it('additionally places role-tagged icons under Sys/def_<role>.info', async () => {
    const blob = await buildOutputZip([icon({ role: 'drawer' })]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file(`${ARCHIVE_BASE_NAME}/folder.info`)).not.toBeNull();
    expect(zip.file(`${ARCHIVE_BASE_NAME}/Sys/def_drawer.info`)).not.toBeNull();
  });

  it('includes a README explaining how to install Sys/ contents', async () => {
    const blob = await buildOutputZip([icon({ role: 'drawer' })]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const readme = await zip.file(`${ARCHIVE_BASE_NAME}/README.txt`)?.async('string');
    expect(readme).toMatch(/ENVARC:Sys/);
    expect(readme).toMatch(/ENV:Sys/);
  });

  /**
   * Unzip tools scatter into the current directory just as `lha x` does, so the zip
   * carries the same single drawer rather than only the LHA doing it.
   */
  it('leaves nothing loose at the zip root', async () => {
    const blob = await buildOutputZip([icon({ role: 'drawer' })]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const loose = Object.keys(zip.files).filter(
      (path) => !path.startsWith(`${ARCHIVE_BASE_NAME}/`) && path !== `${ARCHIVE_BASE_NAME}/`,
    );
    expect(loose).toEqual([]);
  });
});

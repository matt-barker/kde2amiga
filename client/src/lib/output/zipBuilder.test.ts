import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildOutputZip } from './zipBuilder';

describe('buildOutputZip', () => {
  it('places every icon as <name>.info at the zip root', async () => {
    const blob = await buildOutputZip([
      { name: 'folder', infoBytes: new Uint8Array([1, 2, 3]) },
      { name: 'firefox', infoBytes: new Uint8Array([4, 5, 6]) },
    ]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file('folder.info')).not.toBeNull();
    expect(zip.file('firefox.info')).not.toBeNull();
  });

  it('additionally places role-tagged icons under Sys/def_<role>.info', async () => {
    const blob = await buildOutputZip([
      { name: 'folder', infoBytes: new Uint8Array([1, 2, 3]), role: 'drawer' },
    ]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file('folder.info')).not.toBeNull();
    expect(zip.file('Sys/def_drawer.info')).not.toBeNull();
  });

  it('includes a README explaining how to install Sys/ contents', async () => {
    const blob = await buildOutputZip([{ name: 'folder', infoBytes: new Uint8Array([1]) }]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const readme = await zip.file('README.txt')?.async('string');
    expect(readme).toMatch(/ENVARC:Sys/);
    expect(readme).toMatch(/ENV:Sys/);
  });
});

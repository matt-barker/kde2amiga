import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { runConversionJob } from './convertJob';
import type { ThemeIcon } from '../theme/themeParser';

describe('runConversionJob', () => {
  it('produces a zip containing one .info file per input icon', async () => {
    const zip = new JSZip();
    zip.file('scalable/places/folder.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#0000ff"/></svg>');
    zip.file('scalable/apps/firefox.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#ff8800"/></svg>');

    const folderIcon: ThemeIcon = { name: 'folder', category: 'places', sizePx: 0, format: 'svg', zipPath: 'scalable/places/folder.svg' };
    const firefoxIcon: ThemeIcon = { name: 'firefox', category: 'apps', sizePx: 0, format: 'svg', zipPath: 'scalable/apps/firefox.svg' };

    const outputZip = await runConversionJob(
      zip,
      [
        { icon: folderIcon, kind: 'drawer', role: 'drawer' },
        { icon: firefoxIcon, kind: 'tool' },
      ],
      { outputSizePx: 32, maxColors: 16, selectedEffect: 'invert' },
    );

    const parsed = await JSZip.loadAsync(await outputZip.arrayBuffer());
    expect(parsed.file('folder.info')).not.toBeNull();
    expect(parsed.file('firefox.info')).not.toBeNull();
    expect(parsed.file('Sys/def_drawer.info')).not.toBeNull();
  });

  it('skips an icon that fails to decode without aborting the batch', async () => {
    const zip = new JSZip();
    zip.file('scalable/apps/broken.svg', 'not actually valid svg content <<<');
    zip.file('scalable/apps/ok.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#00ff00"/></svg>');

    const brokenIcon: ThemeIcon = { name: 'broken', category: 'apps', sizePx: 0, format: 'svg', zipPath: 'scalable/apps/broken.svg' };
    const okIcon: ThemeIcon = { name: 'ok', category: 'apps', sizePx: 0, format: 'svg', zipPath: 'scalable/apps/ok.svg' };

    const progressLog: Array<[number, number]> = [];
    const outputZip = await runConversionJob(
      zip,
      [{ icon: brokenIcon, kind: 'tool' }, { icon: okIcon, kind: 'tool' }],
      { outputSizePx: 32, maxColors: 16, selectedEffect: 'invert' },
      (done, total) => progressLog.push([done, total]),
    );

    const parsed = await JSZip.loadAsync(await outputZip.arrayBuffer());
    expect(parsed.file('ok.info')).not.toBeNull();
    expect(parsed.file('broken.info')).toBeNull();
    expect(progressLog[progressLog.length - 1]).toEqual([2, 2]);
  });
});

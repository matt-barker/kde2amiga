import { describe, it, expect } from 'vitest';
import { buildOutputLha } from './lhaBuilder';
import { ARCHIVE_BASE_NAME } from './outputEntries';

import type { NewIconState } from '../newicons/newIconsEncoder';
import type { ConvertedIcon } from './outputEntries';

/**
 * A large, uniform icon, so its encoded `.info` is big enough and repetitive enough to
 * compress — the -lh5- signature only appears once compression actually wins over
 * storing the bytes raw (see lhaWriter.ts's `stored` fallback for tiny icons).
 */
function state(): NewIconState {
  const size = 32;
  return {
    width: size,
    height: size,
    transparent: true,
    palette: [[0, 0, 0], [255, 255, 255]],
    pixels: new Array(size * size).fill(1),
  };
}

function icon(overrides: Partial<ConvertedIcon> = {}): ConvertedIcon {
  return {
    name: 'folder',
    width: 32,
    height: 32,
    kind: 'drawer',
    normal: state(),
    selected: state(),
    ...overrides,
  };
}

/**
 * Content-level checks only. That the bytes are a *valid* LHA archive is settled in
 * lha/lhaWriter.oracle.test.ts against the real `lha` binary.
 */
describe('buildOutputLha', () => {
  it('produces bytes carrying the -lh5- method signature', async () => {
    const blob = buildOutputLha([icon()]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.subarray(2, 7))).toBe('-lh5-');
  });

  it('names the archive as LZH content so a browser does not relabel it', () => {
    expect(buildOutputLha([]).type).toBe('application/x-lzh-compressed');
  });

  it('carries the same files the zip would', async () => {
    const blob = buildOutputLha([icon({ role: 'drawer' })]);
    const text = String.fromCharCode(...new Uint8Array(await blob.arrayBuffer()));
    expect(text).toContain('folder.info');
    expect(text).toContain('def_drawer.info');
    expect(text).toContain('README.txt');
    // A level-1 header keeps the directory in a type-0x02 extended header, separated by
    // 0xFF rather than '/', so the drawer is searched for the way the format stores it.
    // Whether it *extracts* to the right place is the oracle test's job, not this one's.
    expect(text).toContain(`${ARCHIVE_BASE_NAME}\xff`);
    expect(text).toContain(`${ARCHIVE_BASE_NAME}\xffSys\xff`);
  });
});

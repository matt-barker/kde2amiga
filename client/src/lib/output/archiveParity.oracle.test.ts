// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import JSZip from 'jszip';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOutputZip } from './zipBuilder';
import { ARCHIVE_BASE_NAME } from './outputEntries';
import { buildOutputLha } from './lhaBuilder';
import type { ConvertedIcon } from './outputEntries';

/**
 * Pins the promise the two download buttons make: whichever one the user picks, they get
 * the same icons. Both archives are unpacked by their real readers — Lhasa for the LHA,
 * JSZip for the zip — and compared file by file.
 *
 * The comparison is what makes `outputEntries` worth having. Before it, the layout lived
 * inside the zip builder, so an LHA builder would have had to restate it and could drift.
 */
const LHA = '/usr/bin/lha';

const ICONS: ConvertedIcon[] = [
  { name: 'folder', infoBytes: Uint8Array.from({ length: 900 }, (_, i) => (i * 7) & 0xff), role: 'drawer' },
  { name: 'firefox', infoBytes: Uint8Array.from({ length: 1500 }, (_, i) => (i % 17) & 0xff) },
  { name: 'trash', infoBytes: Uint8Array.from({ length: 400 }, () => 0x41), role: 'trashcan' },
];

async function unpackZip(icons: ConvertedIcon[]): Promise<Map<string, Uint8Array>> {
  const parsed = await JSZip.loadAsync(await (await buildOutputZip(icons)).arrayBuffer());
  const out = new Map<string, Uint8Array>();
  for (const path of Object.keys(parsed.files)) {
    if (parsed.files[path].dir) continue;
    out.set(path, new Uint8Array(await parsed.files[path].async('uint8array')));
  }
  return out;
}

async function unpackLha(icons: ConvertedIcon[]): Promise<Map<string, Uint8Array>> {
  const dir = mkdtempSync(join(tmpdir(), 'kde2amiga-parity-'));
  const archivePath = join(dir, 'icons.lha');
  writeFileSync(archivePath, new Uint8Array(await buildOutputLha(icons).arrayBuffer()));
  execFileSync(LHA, ['t', archivePath], { stdio: 'pipe' });

  const out = join(dir, 'out');
  mkdirSync(out);
  execFileSync(LHA, [`xw=${out}`, archivePath], { stdio: 'pipe' });

  // Listing rather than walking: it also proves the paths Lhasa reports are the ones we
  // meant, including the Sys/ nesting carried in the directory extended header.
  const listing = execFileSync(LHA, ['l', archivePath], { encoding: 'utf8' });
  const paths = listing
    .split('\n')
    .map((line) => line.trim().split(/\s+/).pop() ?? '')
    .filter((name) => name.endsWith('.info') || name.endsWith('.txt'));

  return new Map(paths.map((path) => [path, new Uint8Array(readFileSync(join(out, path)))]));
}

describe('zip and LHA parity, verified by Lhasa', () => {
  beforeAll(() => {
    if (!existsSync(LHA)) {
      throw new Error(`${LHA} not found; install the "lhasa" package rather than skipping.`);
    }
  });

  it('offers exactly the same paths in both formats', async () => {
    const [zip, lha] = [await unpackZip(ICONS), await unpackLha(ICONS)];
    expect([...lha.keys()].sort()).toEqual([...zip.keys()].sort());
  });

  it('offers byte-identical contents in both formats', async () => {
    const [zip, lha] = [await unpackZip(ICONS), await unpackLha(ICONS)];
    for (const [path, bytes] of zip) expect(lha.get(path)).toEqual(bytes);
  });

  /**
   * The bug this drawer exists to stop, checked the way it was found: `lha x` extracts
   * into the current directory, so a flat archive scatters every .info file across
   * whatever drawer the user ran it from. Verified with the real binary, not our reader.
   */
  it('extracts into exactly one drawer rather than scattering files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kde2amiga-drawer-'));
    writeFileSync(join(dir, 'icons.lha'), new Uint8Array(await buildOutputLha(ICONS).arrayBuffer()));

    // `xw=` is deliberately not used: this reproduces a bare `lha x` in the current
    // directory, which is exactly how the scattering was reported.
    execFileSync(LHA, ['x', join(dir, 'icons.lha')], { cwd: dir, stdio: 'pipe' });

    expect(readdirSync(dir).filter((name) => name !== 'icons.lha')).toEqual([ARCHIVE_BASE_NAME]);
  });

  it('names that drawer after the archive, so renaming the download renames the drawer', async () => {
    const lha = await unpackLha(ICONS);
    for (const path of lha.keys()) expect(path.startsWith(`${ARCHIVE_BASE_NAME}/`)).toBe(true);
  });

  it('carries the system-default icons under Sys/ in the LHA too', async () => {
    const lha = await unpackLha(ICONS);
    expect([...lha.keys()]).toEqual(
      expect.arrayContaining([
        `${ARCHIVE_BASE_NAME}/Sys/def_drawer.info`,
        `${ARCHIVE_BASE_NAME}/Sys/def_trashcan.info`,
      ]),
    );
  });
});

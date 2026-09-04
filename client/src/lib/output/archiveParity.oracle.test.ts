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
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { buildOutputZip } from './zipBuilder';
import { ARCHIVE_BASE_NAME } from './outputEntries';
import { INSTALLER_SCRIPT_NAME } from './installerScript';
import { buildOutputLha } from './lhaBuilder';
import type { ConvertedIcon } from './outputEntries';
import type { NewIconState } from '../newicons/newIconsEncoder';

/**
 * Pins the promise the two download buttons make: whichever one the user picks, they get
 * the same icons. Both archives are unpacked by their real readers — Lhasa for the LHA,
 * JSZip for the zip — and compared file by file.
 *
 * The comparison is what makes `outputEntries` worth having. Before it, the layout lived
 * inside the zip builder, so an LHA builder would have had to restate it and could drift.
 */
const LHA = '/usr/bin/lha';

function state(size: number, fill: number): NewIconState {
  return {
    width: size,
    height: size,
    transparent: true,
    palette: [[0, 0, 0], [255, 255, 255]],
    pixels: new Array(size * size).fill(fill),
  };
}

const ICONS: ConvertedIcon[] = [
  {
    name: 'folder',
    width: 24,
    height: 24,
    kind: 'drawer',
    normal: state(24, 0),
    selected: state(24, 1),
    role: 'drawer',
  },
  {
    name: 'firefox',
    width: 32,
    height: 32,
    kind: 'tool',
    normal: state(32, 1),
    selected: state(32, 0),
    // Carries a Workbench target so the comparison sees a three-level path. Everything
    // else here is one or two levels deep, and this is the only test that puts both
    // archives through their real readers — a format that mangled `Wb/SYS/Prefs/` would
    // have got past it. Real `lha` round-trips such a path; this keeps it that way.
    target: 'SYS:Prefs/Font',
  },
  {
    name: 'trash',
    width: 16,
    height: 16,
    kind: 'trashcan',
    normal: state(16, 0),
    selected: state(16, 0),
    role: 'trashcan',
  },
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

/** Every file under `root`, keyed by its path relative to `root` with `/` separators. */
function walk(root: string, at = root, into = new Map<string, Uint8Array>()): Map<string, Uint8Array> {
  for (const name of readdirSync(at)) {
    const path = join(at, name);
    if (statSync(path).isDirectory()) walk(root, path, into);
    else into.set(relative(root, path).split(sep).join('/'), new Uint8Array(readFileSync(path)));
  }
  return into;
}

/**
 * Walks what Lhasa extracted rather than parsing what `lha l` prints.
 *
 * The listing used to be the source of truth here, on the grounds that it also proved
 * the paths Lhasa reports are the ones we meant. It cannot be: its filename column is
 * whitespace-delimited, so `Install Default Icons.info` came back as `Icons.info`, and
 * the extension filter that went with it dropped the extensionless installer script from
 * the comparison altogether — the two formats could have disagreed about it in silence.
 * `lhaListing` below keeps the reporting check, without it deciding what gets compared.
 */
async function unpackLha(icons: ConvertedIcon[]): Promise<Map<string, Uint8Array>> {
  const dir = mkdtempSync(join(tmpdir(), 'kde2amiga-parity-'));
  const archivePath = join(dir, 'icons.lha');
  writeFileSync(archivePath, new Uint8Array(await buildOutputLha(icons).arrayBuffer()));
  execFileSync(LHA, ['t', archivePath], { stdio: 'pipe' });

  const out = join(dir, 'out');
  mkdirSync(out);
  execFileSync(LHA, [`xw=${out}`, archivePath], { stdio: 'pipe' });
  return walk(out);
}

async function lhaListing(icons: ConvertedIcon[]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'kde2amiga-listing-'));
  const archivePath = join(dir, 'icons.lha');
  writeFileSync(archivePath, new Uint8Array(await buildOutputLha(icons).arrayBuffer()));
  return execFileSync(LHA, ['l', archivePath], { encoding: 'utf8' });
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

  /**
   * Kept from the version of `unpackLha` that read the listing: the paths Lhasa *reports*
   * should be the ones we meant, Sys/ nesting and spaces included.
   */
  it('reports every extracted path in its own listing', async () => {
    const [listing, lha] = [await lhaListing(ICONS), await unpackLha(ICONS)];
    for (const path of lha.keys()) expect(listing).toContain(path);
  });

  it('carries the installer script and its icon through the LHA with their spaces intact', async () => {
    // Both sides of the comparison come from the constant, so without this the test
    // would stay green after a rename that left no spaces to survive anything.
    expect(INSTALLER_SCRIPT_NAME).toContain(' ');

    const lha = await unpackLha(ICONS);
    expect([...lha.keys()]).toEqual(
      expect.arrayContaining([
        `${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}`,
        `${ARCHIVE_BASE_NAME}/${INSTALLER_SCRIPT_NAME}.info`,
      ]),
    );
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

  /**
   * The deepest path either format has to carry. Asserted against what Lhasa actually
   * wrote to disk rather than against the entry list, because the two-level `Sys/` case
   * proved nothing about a third level.
   */
  it('carries the three-level Wb/ tree through the LHA', async () => {
    const lha = await unpackLha(ICONS);
    expect([...lha.keys()]).toContain(`${ARCHIVE_BASE_NAME}/Wb/SYS/Prefs/Font.info`);
  });
});

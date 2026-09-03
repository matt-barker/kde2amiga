// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLhaArchive, type LhaEntry } from './lhaWriter';

/**
 * The acceptance gate for the whole LHA encoder, run against Lhasa — the reference
 * decoder `lha` itself is built from.
 *
 * Nothing else in this directory can prove the format is right. A decoder written
 * alongside the encoder shares the encoder's misreadings, which is exactly how our
 * NewIcons encoder once passed 63 tests while producing files AmigaOS refused; see
 * newicons/diskObjectDecoderForTest.ts for the note it left behind.
 *
 * If `lha` is missing this FAILS rather than skips. A skipped oracle reports green while
 * proving nothing, which is the failure mode this test exists to prevent.
 */
const LHA = '/usr/bin/lha';

function extractWith(entries: LhaEntry[]): Map<string, Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'kde2amiga-lha-'));
  const archivePath = join(dir, 'icons.lha');
  writeFileSync(archivePath, buildLhaArchive(entries));

  // `t` verifies each entry's CRC after decompressing it, so it fails on a stream that
  // unpacks to the wrong bytes even when the container is well formed.
  execFileSync(LHA, ['t', archivePath], { stdio: 'pipe' });

  const out = join(dir, 'out');
  mkdirSync(out);
  execFileSync(LHA, [`xw=${out}`, archivePath], { stdio: 'pipe' });

  return new Map(
    entries.map((entry) => [entry.path, new Uint8Array(readFileSync(join(out, entry.path)))]),
  );
}

function listWith(entries: LhaEntry[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'kde2amiga-lha-'));
  const archivePath = join(dir, 'icons.lha');
  writeFileSync(archivePath, buildLhaArchive(entries));
  return execFileSync(LHA, ['v', archivePath], { encoding: 'utf8' });
}

const bytesOf = (text: string) => Uint8Array.from(new TextEncoder().encode(text));

describe('LHA archives, verified by Lhasa', () => {
  beforeAll(() => {
    if (!existsSync(LHA)) {
      throw new Error(
        `${LHA} not found. The LHA encoder has no other oracle: install the "lhasa" ` +
          'package rather than skipping this test.',
      );
    }
  });

  it('round-trips highly compressible data', () => {
    const payload = bytesOf('ABCDEFGH'.repeat(2000));
    const extracted = extractWith([{ path: 'repeat.info', bytes: payload }]);
    expect(extracted.get('repeat.info')).toEqual(payload);
  });

  it('round-trips a long run of one byte', () => {
    const payload = new Uint8Array(30000).fill(0x5a);
    const extracted = extractWith([{ path: 'run.info', bytes: payload }]);
    expect(extracted.get('run.info')).toEqual(payload);
  });

  it('round-trips incompressible pseudo-random bytes', () => {
    const payload = new Uint8Array(20000);
    let seed = 987654321;
    for (let i = 0; i < payload.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      payload[i] = (seed >>> 16) & 0xff;
    }
    const extracted = extractWith([{ path: 'noise.info', bytes: payload }]);
    expect(extracted.get('noise.info')).toEqual(payload);
  });

  it('round-trips data larger than the 16KB window', () => {
    // Forces offsets across the full range of offset codes, and more than one block.
    const payload = new Uint8Array(300000);
    for (let i = 0; i < payload.length; i++) payload[i] = (i % 251) & 0xff;
    const extracted = extractWith([{ path: 'big.info', bytes: payload }]);
    expect(extracted.get('big.info')).toEqual(payload);
  });

  it('round-trips real NewIcons .info fixtures', () => {
    const here = new URL('../../newicons/__fixtures__/', import.meta.url).pathname;
    const entries = ['Apps.info', '0016.info'].map((name) => ({
      path: name,
      bytes: new Uint8Array(readFileSync(join(here, name))),
    }));
    const extracted = extractWith(entries);
    for (const entry of entries) expect(extracted.get(entry.path)).toEqual(entry.bytes);
  });

  it('round-trips an entry nested in a directory', () => {
    const payload = bytesOf('drawer icon'.repeat(200));
    const extracted = extractWith([{ path: 'Sys/def_drawer.info', bytes: payload }]);
    expect(extracted.get('Sys/def_drawer.info')).toEqual(payload);
  });

  it('round-trips a whole mixed archive in one pass', () => {
    const entries: LhaEntry[] = [
      { path: 'folder.info', bytes: bytesOf('folder'.repeat(500)) },
      { path: 'firefox.info', bytes: bytesOf('firefox'.repeat(500)) },
      { path: 'Sys/def_drawer.info', bytes: bytesOf('drawer'.repeat(500)) },
      { path: 'Sys/def_tool.info', bytes: bytesOf('tool'.repeat(500)) },
      { path: 'README.txt', bytes: bytesOf('install to ENVARC:Sys/ and ENV:Sys/\n') },
      { path: 'tiny.info', bytes: Uint8Array.from([1, 2, 3, 4]) },
    ];
    const extracted = extractWith(entries);
    for (const entry of entries) expect(extracted.get(entry.path)).toEqual(entry.bytes);
  });

  it('round-trips an empty file', () => {
    const extracted = extractWith([{ path: 'empty.info', bytes: new Uint8Array([]) }]);
    expect(extracted.get('empty.info')).toEqual(new Uint8Array([]));
  });

  it('is reported by Lhasa as -lh5- carrying the Amiga OS identifier', () => {
    const listing = listWith([{ path: 'folder.info', bytes: bytesOf('folder'.repeat(500)) }]);
    expect(listing).toMatch(/-lh5-/);
    expect(listing).toMatch(/\[Amiga\]/);
  });

  it('actually compresses, rather than falling back to stored', () => {
    const listing = listWith([{ path: 'folder.info', bytes: bytesOf('ABCDEFGH'.repeat(2000)) }]);
    expect(listing).not.toMatch(/-lh0-/);
  });
});

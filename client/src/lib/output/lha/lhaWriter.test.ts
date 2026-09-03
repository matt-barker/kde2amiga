import { describe, it, expect } from 'vitest';
import { buildLhaArchive } from './lhaWriter';
import { crc16 } from './crc16';

/**
 * Field offsets read straight off a level-1 header, checked against the ones decoded
 * from a real Amiga archive (Downloads/AmigaOS-3.2.3.lha) rather than from the LHA
 * documentation: that archive is known to install on the OS 3.2.3 target.
 */
function baseHeaderOf(archive: Uint8Array) {
  const headerLength = archive[0];
  const base = archive.subarray(0, headerLength + 2);
  const nameLength = base[21];
  const view = new DataView(base.buffer, base.byteOffset, base.byteLength);
  return {
    headerLength,
    checksum: base[1],
    method: String.fromCharCode(...base.subarray(2, 7)),
    skipSize: view.getUint32(7, true),
    originalSize: view.getUint32(11, true),
    attribute: base[19],
    level: base[20],
    name: String.fromCharCode(...base.subarray(22, 22 + nameLength)),
    crc: view.getUint16(22 + nameLength, true),
    osType: String.fromCharCode(base[24 + nameLength]),
    firstExtSize: view.getUint16(25 + nameLength, true),
    totalBaseBytes: headerLength + 2,
  };
}

const bytesOf = (text: string) => Uint8Array.from(new TextEncoder().encode(text));

describe('buildLhaArchive', () => {
  it('writes a level-1 header carrying the Amiga OS identifier', () => {
    const header = baseHeaderOf(buildLhaArchive([{ path: 'folder.info', bytes: bytesOf('hello') }]));
    expect(header.level).toBe(1);
    expect(header.osType).toBe('A');
  });

  it('names the method it actually used', () => {
    const header = baseHeaderOf(
      buildLhaArchive([{ path: 'folder.info', bytes: bytesOf('x'.repeat(4000)) }]),
    );
    expect(header.method).toBe('-lh5-');
  });

  it('falls back to stored when compression would make the file bigger', () => {
    // Four incompressible bytes: the lh5 tables alone cost more than the data.
    const header = baseHeaderOf(
      buildLhaArchive([{ path: 'tiny.info', bytes: Uint8Array.from([1, 2, 3, 4]) }]),
    );
    expect(header.method).toBe('-lh0-');
    expect(header.originalSize).toBe(4);
    expect(header.skipSize).toBe(4);
  });

  it('records the uncompressed size and a CRC of the uncompressed data', () => {
    const payload = bytesOf('the quick brown fox'.repeat(30));
    const header = baseHeaderOf(buildLhaArchive([{ path: 'a.info', bytes: payload }]));
    expect(header.originalSize).toBe(payload.length);
    expect(header.crc).toBe(crc16(payload));
  });

  it('checksums every header byte after the length and checksum fields', () => {
    const archive = buildLhaArchive([{ path: 'folder.info', bytes: bytesOf('hello world') }]);
    const header = baseHeaderOf(archive);
    let sum = 0;
    for (let i = 2; i < header.totalBaseBytes; i++) sum += archive[i];
    expect(header.checksum).toBe(sum & 0xff);
  });

  it('puts a root-level file in the base header with no extended headers', () => {
    const header = baseHeaderOf(buildLhaArchive([{ path: 'folder.info', bytes: bytesOf('hi') }]));
    expect(header.name).toBe('folder.info');
    expect(header.firstExtSize).toBe(0);
  });

  it('splits a nested path into a basename and a directory extended header', () => {
    // Exactly what AmigaOS-3.2.3.lha does: base header holds "ADFs.info", a type-0x02
    // extended header holds "Update3.2.3\xff".
    const archive = buildLhaArchive([{ path: 'Sys/def_drawer.info', bytes: bytesOf('hi') }]);
    const header = baseHeaderOf(archive);
    expect(header.name).toBe('def_drawer.info');
    expect(header.firstExtSize).toBeGreaterThan(0);

    const ext = archive.subarray(header.totalBaseBytes, header.totalBaseBytes + header.firstExtSize);
    expect(ext[0]).toBe(0x02);
    expect(String.fromCharCode(...ext.subarray(1, ext.length - 2))).toBe('Sys\xff');
  });

  it('adds the extended header bytes to the skip size so a reader can step over them', () => {
    const archive = buildLhaArchive([{ path: 'Sys/def_drawer.info', bytes: bytesOf('hi') }]);
    const header = baseHeaderOf(archive);
    // skipSize = compressed bytes + every extended header byte; -lh0- here, so 2 + ext.
    expect(header.skipSize).toBe(2 + header.firstExtSize);
  });

  it('terminates the archive with a zero byte', () => {
    const archive = buildLhaArchive([{ path: 'a.info', bytes: bytesOf('hi') }]);
    expect(archive[archive.length - 1]).toBe(0);
  });

  it('writes one header per entry', () => {
    const archive = buildLhaArchive([
      { path: 'a.info', bytes: bytesOf('hi') },
      { path: 'b.info', bytes: bytesOf('there') },
    ]);
    const first = baseHeaderOf(archive);
    const second = baseHeaderOf(archive.subarray(first.totalBaseBytes + first.skipSize));
    expect(first.name).toBe('a.info');
    expect(second.name).toBe('b.info');
  });

  it('produces just the terminator for no entries', () => {
    expect(buildLhaArchive([])).toEqual(new Uint8Array([0]));
  });
});

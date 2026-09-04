import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { INSTALLER_ASSET_BASE } from './installerBinary';

// Built via path.join rather than `new URL(rel, import.meta.url)`: Vite recognises that
// exact pattern and rewrites it into a dev-server asset URL (`http://.../@fs/...`), which
// `fileURLToPath` then rejects as not a `file:` URL. Splitting the two steps sidesteps the
// rewrite so this reads straight off disk.
const here = fileURLToPath(import.meta.url);
const repoFile = (name: string) => readFileSync(join(dirname(here), '../../../../Installer43_3', name));

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * Licence clause B.1: "The Files may be reproduced but may not be modified in any way."
 *
 * There is no way to notice a modified binary from the output — it would simply misbehave
 * on the Amiga — so the repository copy is pinned by hash instead. A failure here means
 * either the file was touched, or it was replaced with a different release, and clause
 * B.7 requires the most recently approved one.
 */
describe('the bundled Installer', () => {
  it('is the unmodified Installer 43.3 binary', () => {
    expect(sha256(repoFile('Installer'))).toBe(
      '70237f51e1e7cf3025123a983df7e65e18eb6206e97c7b8d3662ca3373047f1e',
    );
  });

  it('travels with the licence clause B.5 requires', () => {
    expect(sha256(repoFile('Installer.license'))).toBe(
      '1bf9c2c9f9d5b987d2f73a65589f63b63102d740ebb43d8513254186457cbabd',
    );
  });

  it('is served from a path the Vite plugin and the loader agree on', () => {
    expect(INSTALLER_ASSET_BASE).toBe('/installer');
  });
});

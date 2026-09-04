import { describe, it, expect, vi, afterEach } from 'vitest';
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

/**
 * The loader memoises so a user converting twice does not refetch 110KB. Memoising the
 * promise rather than the result is what made a single transient failure permanent: the
 * rejection was cached too, and every later conversion in that tab failed until reload,
 * over a fetch a retry would very likely have fixed.
 *
 * Each test re-imports the module so it starts with an empty cache, and drives the real
 * loader with a stubbed `fetch` — mocking the module instead would test the mock.
 */
describe('loadInstallerFiles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const bytes = (n: number) => new Uint8Array([n]);

  function stubFetch(responses: (() => Response)[]) {
    const fetches: string[] = [];
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetches.push(url);
      return responses[Math.min(call++, responses.length - 1)]();
    }));
    return fetches;
  }

  const ok = () => new Response(bytes(0x42), { status: 200 });
  const missing = () => new Response(null, { status: 404 });

  async function loader() {
    vi.resetModules();
    return (await import('./installerBinary')).loadInstallerFiles;
  }

  it('fetches once and serves every later caller from the cache', async () => {
    const fetches = stubFetch([ok]);
    const load = await loader();

    await load();
    await load();

    expect(fetches).toEqual(['/installer/Installer', '/installer/Installer.license']);
  });

  it('reports which file it could not load', async () => {
    stubFetch([missing]);
    const load = await loader();

    await expect(load()).rejects.toThrow(/Installer \(HTTP 404\)/);
  });

  it('does not cache a failure, so the next conversion can still succeed', async () => {
    let succeed = false;
    stubFetch([() => (succeed ? ok() : missing())]);
    const load = await loader();

    await expect(load()).rejects.toThrow();
    succeed = true;

    await expect(load()).resolves.toMatchObject({ binary: bytes(0x42) });
  });
});

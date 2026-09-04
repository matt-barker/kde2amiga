import { INSTALLER_BINARY_NAME, INSTALLER_LICENSE_NAME } from './installerScript';

/**
 * Where the Vite plugin serves the bundled Installer from.
 *
 * Duplicated as a literal in `vite.config.ts` rather than imported: the config runs in
 * Node, and pulling a client module into it to share one string is the worse trade. The
 * test below pins this half; the plugin's half is the `/installer/` in its middleware.
 */
export const INSTALLER_ASSET_BASE = '/installer';

export interface InstallerFiles {
  binary: Uint8Array;
  license: Uint8Array;
}

let cached: Promise<InstallerFiles> | null = null;

async function fetchAsset(name: string): Promise<Uint8Array> {
  const response = await fetch(`${INSTALLER_ASSET_BASE}/${name}`);
  if (!response.ok) {
    throw new Error(`Could not load ${name} (HTTP ${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Loads the Installer and its licence, once per page.
 *
 * Fetched rather than compiled into the bundle: it is 110KB of 68k executable that would
 * otherwise inflate every page load, base64'd, for a file only used at download time.
 */
export function loadInstallerFiles(): Promise<InstallerFiles> {
  cached ??= Promise.all([
    fetchAsset(INSTALLER_BINARY_NAME),
    fetchAsset(INSTALLER_LICENSE_NAME),
  ]).then(([binary, license]) => ({ binary, license }));

  return cached;
}

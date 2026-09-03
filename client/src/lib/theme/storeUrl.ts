/**
 * Resolving a store.kde.org product page to the archive behind it.
 *
 * The product page never renders a download link — the real URL is a short-lived signed
 * token handed out by the OCS (Open Collaboration Services) API that backs the store. So
 * a pasted page URL has to be turned into an id, asked about, and only then downloaded.
 *
 * Everything here is pure: the two network hops (the OCS lookup and the archive itself)
 * both belong to the caller, which routes them through the app's own proxy. That matters
 * for more than tidiness — see ThemeLoader for why both hops must share one origin.
 */

export type StoreFile = { name: string; url: string; sizeKb: number };
export type StoreProduct = { name: string; files: StoreFile[] };

/**
 * store.kde.org and pling.com are one site wearing two names: they share a single id
 * space, and the kde-look OCS endpoint resolves ids from either. Accepting both costs a
 * hostname in this list and saves the user noticing which one they copied.
 */
const PRODUCT_HOSTS = new Set([
  'store.kde.org',
  'www.store.kde.org',
  'pling.com',
  'www.pling.com',
]);

const PRODUCT_PATH = /^\/p\/(\d+)\/?$/;

/** The product id in a pasted page URL, or null if that isn't what was pasted. */
export function parseStoreProductId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!PRODUCT_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  // Only the path is matched, so a query string or fragment on the pasted link is
  // ignored rather than being treated as part of the id.
  const match = PRODUCT_PATH.exec(parsed.pathname);
  return match ? match[1] : null;
}

export function ocsProductUrl(id: string): string {
  return `https://api.kde-look.org/ocs/v1/content/data/${id}?format=json`;
}

function slotNumbers(content: Record<string, unknown>): number[] {
  const slots: number[] = [];
  for (const key of Object.keys(content)) {
    const match = /^downloadlink(\d+)$/.exec(key);
    if (match && typeof content[key] === 'string' && content[key] !== '') {
      slots.push(Number(match[1]));
    }
  }
  // Numeric, not lexicographic: the twelve-variant themes on the store would otherwise
  // list slot 10 between slot 1 and slot 2.
  return slots.sort((a, b) => a - b);
}

/**
 * Reads an OCS content reply into a product.
 *
 * Throws rather than returning an empty product, because both failures here are things
 * the user needs told: an id that no longer exists, and a product with nothing to fetch.
 */
export function parseStoreProduct(payload: unknown): StoreProduct {
  const envelope = payload as { statuscode?: number; data?: unknown };
  const data = envelope?.data;

  // An unknown id is not an HTTP error: the API answers 200 with statuscode 999 and
  // omits the data array entirely, so the envelope is the only thing that tells us.
  if (envelope?.statuscode !== 100 || !Array.isArray(data) || data.length === 0) {
    throw new Error('No product found for that store.kde.org URL.');
  }

  const content = data[0] as Record<string, unknown>;
  const files: StoreFile[] = slotNumbers(content).map((slot) => {
    const name = content[`downloadname${slot}`];
    const size = Number(content[`downloadsize${slot}`]);
    return {
      name: typeof name === 'string' && name !== '' ? name : `Download ${slot}`,
      url: content[`downloadlink${slot}`] as string,
      sizeKb: Number.isFinite(size) ? size : 0,
    };
  });

  if (files.length === 0) {
    throw new Error('That product has no downloadable file.');
  }

  const name = content.name;
  return { name: typeof name === 'string' ? name : '', files };
}

const MDI_CDN_BASE = 'https://cdn.jsdelivr.net/npm/@mdi/svg/svg';

export async function fetchMdiBadgeSvg(iconName: string, proxyBaseUrl?: string): Promise<string> {
  const directUrl = `${MDI_CDN_BASE}/${iconName}.svg`;

  try {
    const response = await fetch(directUrl);
    if (response.ok) return response.text();
  } catch {
    // fall through to proxy attempt below
  }

  if (proxyBaseUrl) {
    try {
      const proxied = await fetch(`${proxyBaseUrl}?url=${encodeURIComponent(directUrl)}`);
      if (proxied.ok) return proxied.text();
    } catch {
      // fall through to the descriptive error below
    }
  }

  throw new Error(`Could not fetch MDI badge "${iconName}" (direct fetch failed${proxyBaseUrl ? ' and proxy fetch failed' : ', no proxy configured'})`);
}

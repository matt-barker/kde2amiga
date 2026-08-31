import { describe, it, expect } from 'vitest';
import { rasterizeSvg, decodePng } from './decode';

describe('rasterizeSvg', () => {
  it('rasterizes an SVG to the requested output size', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
      <rect width="24" height="24" fill="#ff0000"/>
    </svg>`;
    const image = await rasterizeSvg(svg, 16);
    expect(image.width).toBe(16);
    expect(image.height).toBe(16);
    // center pixel should be opaque red
    const centerIndex = (8 * 16 + 8) * 4;
    expect(image.data[centerIndex]).toBeGreaterThan(200);
    expect(image.data[centerIndex + 3]).toBe(255);
  });

  it('rasterizes a viewBox-only SVG that declares no width or height', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#0000ff"/></svg>';
    const image = await rasterizeSvg(svg, 16);
    expect(image.width).toBe(16);
    const centerIndex = (8 * 16 + 8) * 4;
    expect(image.data[centerIndex + 2]).toBeGreaterThan(200); // blue
    expect(image.data[centerIndex + 3]).toBe(255);
  });
});

describe('decodePng', () => {
  it('decodes and resizes a PNG to the requested output size', async () => {
    // 1x1 red PNG (well-known minimal fixture)
    const base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const image = await decodePng(bytes, 8);
    expect(image.width).toBe(8);
    expect(image.height).toBe(8);
  });
});

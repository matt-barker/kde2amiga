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

describe('rasterizeSvg viewport handling', () => {
  it('scales a width/height-only SVG down instead of cropping it', async () => {
    // Slot-Symbolic-Dark's utilities-tweak-tool is 64 user units with no viewBox
    // (enjoy-music-player is 62); every Papirus icon is shaped this way too.
    // Shrinking the viewport on such a file moves the clip rectangle without
    // remapping user units, so the drawing keeps its original scale and only its
    // top-left corner survives — at the default 32px output, exactly a quarter of
    // the icon. The blue square sits in the bottom-right quadrant of the 64-unit
    // canvas, so it disappears entirely under the bug.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
      <rect x="0" y="0" width="32" height="32" fill="#ff0000"/>
      <rect x="32" y="32" width="32" height="32" fill="#0000ff"/>
    </svg>`;
    const image = await rasterizeSvg(svg, 32);

    const at = (x: number, y: number) => {
      const i = (y * 32 + x) * 4;
      return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
    };
    expect(at(8, 8)).toEqual([255, 0, 0, 255]); // top-left stays red
    expect(at(24, 24)).toEqual([0, 0, 255, 255]); // bottom-right must still be blue
  });
});

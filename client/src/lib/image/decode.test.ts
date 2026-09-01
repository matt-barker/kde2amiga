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

describe('inset margin', () => {
  /** A full-bleed red square: with no inset it reaches every edge of the canvas. */
  const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
      <rect width="24" height="24" fill="#ff0000"/>
    </svg>`;

  const alphaAt = (image: { width: number; data: Uint8ClampedArray }, x: number, y: number) =>
    image.data[(y * image.width + x) * 4 + 3];

  it('keeps the canvas at the requested size and shrinks the artwork into it', async () => {
    // The halo has to be drawn somewhere, and both states of an .info share one gadget
    // box — so the room comes out of the artwork, exactly as GlowIcons does it: 38x38 of
    // drawing inside a ~46px box.
    const image = await rasterizeSvg(fullBleed, 48, 4);
    expect(image.width).toBe(48);
    expect(image.height).toBe(48);
    expect(alphaAt(image, 1, 24)).toBe(0);
    expect(alphaAt(image, 24, 1)).toBe(0);
  });

  it('centres the artwork, leaving the margin clear on all four sides', async () => {
    const image = await rasterizeSvg(fullBleed, 48, 4);
    expect(alphaAt(image, 46, 24)).toBe(0);
    expect(alphaAt(image, 24, 46)).toBe(0);
    expect(alphaAt(image, 24, 24)).toBe(255);
  });

  it('fills the canvas edge to edge when no margin is asked for', async () => {
    const image = await rasterizeSvg(fullBleed, 48, 0);
    expect(alphaAt(image, 0, 24)).toBe(255);
    expect(alphaAt(image, 47, 24)).toBe(255);
  });

  it('insets a decoded PNG the same way it insets an SVG', async () => {
    // 1x1 red PNG (well-known minimal fixture)
    const base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const image = await decodePng(bytes, 48, 4);
    expect(image.width).toBe(48);
    expect(alphaAt(image, 1, 24)).toBe(0);
    // The fixture is itself semi-transparent, so this asserts the artwork landed in the
    // middle at all, not that it is opaque.
    expect(alphaAt(image, 24, 24)).toBeGreaterThan(0);
  });
});

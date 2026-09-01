import { describe, it, expect } from 'vitest';
import { buildSharedPalette, mapImageToPalette, type RgbaImage } from './quantize';
import { maxColorsForSingleLine } from '../newicons/paletteLimits';

function solidImage(width: number, height: number, rgba: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
}

describe('buildSharedPalette', () => {
  it('always reserves index 0 for transparent/background black', () => {
    const palette = buildSharedPalette([solidImage(2, 2, [255, 0, 0, 255])], 8);
    expect(palette[0]).toEqual([0, 0, 0]);
  });

  it('never exceeds maxColors', () => {
    const images = [
      solidImage(2, 2, [255, 0, 0, 255]),
      solidImage(2, 2, [0, 255, 0, 255]),
      solidImage(2, 2, [0, 0, 255, 255]),
    ];
    const palette = buildSharedPalette(images, 2);
    expect(palette.length).toBeLessThanOrEqual(2);
  });

  it('never exceeds the single-line palette ceiling even when asked for far more', () => {
    const size = 16;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      data.set([i, (i * 7) % 256, (i * 13) % 256, 255], i * 4);
    }
    const palette = buildSharedPalette([{ width: size, height: size, data }], 1000);
    expect(palette.length).toBeLessThanOrEqual(maxColorsForSingleLine());
    expect(palette.length).toBe(maxColorsForSingleLine());
  });

  it('returns just the reserved slot for a fully-transparent image without throwing', () => {
    const image = solidImage(4, 4, [0, 0, 0, 0]);
    expect(() => buildSharedPalette([image], 8)).not.toThrow();
    const palette = buildSharedPalette([image], 8);
    expect(palette).toEqual([[0, 0, 0]]);
  });
});

describe('mapImageToPalette', () => {
  it('maps fully transparent pixels to index 0', () => {
    const image = solidImage(1, 1, [10, 20, 30, 0]);
    const palette: [number, number, number][] = [[0, 0, 0], [10, 20, 30]];
    expect(mapImageToPalette(image, palette)).toEqual([0]);
  });

  it('maps opaque pixels to their nearest palette color', () => {
    const image = solidImage(1, 1, [12, 18, 29, 255]);
    const palette: [number, number, number][] = [[0, 0, 0], [10, 20, 30], [200, 200, 200]];
    expect(mapImageToPalette(image, palette)).toEqual([1]);
  });

  it('maps an opaque near-black pixel to a real dark palette entry, never to index 0', () => {
    // pixel (2,2,2) is nearer to reserved [0,0,0] than to [10,10,10], but index 0
    // must be excluded from the search so opaque dark pixels don't become holes.
    const image = solidImage(1, 1, [2, 2, 2, 255]);
    const palette: [number, number, number][] = [[0, 0, 0], [10, 10, 10], [200, 200, 200]];
    expect(mapImageToPalette(image, palette)).toEqual([1]);
  });
});

describe('faint pixels', () => {
  // The Amiga has no partial alpha: an icon pixel is either drawn or it is not.
  // Treating every alpha > 0 as fully drawn is what turned the soft drop shadows
  // and anti-aliased skirts that modern themes rely on into solid paint — in
  // Slot-Symbolic-Dark's utilities-tweak-tool, 41% of pixels at 32px sit in the
  // alpha 1-127 band, so nearly half the icon rendered at full strength as a grey
  // haze that merged into the Workbench background.
  function pixelImage(pixels: [number, number, number, number][]): RgbaImage {
    const data = new Uint8ClampedArray(pixels.length * 4);
    pixels.forEach((p, i) => data.set(p, i * 4));
    return { width: pixels.length, height: 1, data };
  }

  it('maps a barely-there pixel to transparent rather than to full-strength paint', () => {
    const image = pixelImage([
      [255, 0, 0, 255], // solid red
      [0, 0, 255, 40], // a faint shadow skirt, ~16% opacity
    ]);
    const palette = buildSharedPalette([image], 8);
    expect(mapImageToPalette(image, palette)[1]).toBe(0);
  });

  it('keeps a mostly-opaque edge pixel', () => {
    const image = pixelImage([[255, 0, 0, 255], [0, 0, 255, 200]]);
    const palette = buildSharedPalette([image], 8);
    expect(mapImageToPalette(image, palette)[1]).not.toBe(0);
  });

  it('spends no palette slots on colours only faint pixels use', () => {
    // Every visible pixel is red; the blues exist only as a faint shadow. A
    // palette that lists blue has spent scarce Amiga colours on pixels that
    // will not be drawn.
    const image = pixelImage([
      [255, 0, 0, 255],
      [0, 0, 255, 30],
      [0, 0, 200, 20],
      [0, 0, 160, 10],
    ]);
    const palette = buildSharedPalette([image], 8);
    for (const [, , blue] of palette.slice(1)) expect(blue).toBeLessThan(128);
  });
});

describe('dithered colour', () => {
  function flat(width: number, height: number, rgb: [number, number, number]): RgbaImage {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
    return { width, height, data };
  }
  const TWO_BLUES: [number, number, number][] = [[0, 0, 0], [0x51, 0x81, 0xb0], [0x61, 0x90, 0xc0]];

  it('leaves a colour that matches a palette entry exactly alone', () => {
    // Ordered dithering must not add noise to flat artwork. A pixel sitting on a
    // palette entry has no residual to spread, so it takes that entry every time.
    const indices = mapImageToPalette(flat(8, 8, [0x51, 0x81, 0xb0]), TWO_BLUES);
    expect(new Set(indices)).toEqual(new Set([1]));
  });

  it('alternates between the two nearest entries for a colour midway between them', () => {
    // This is the GlowIcons trick: the ScreenMode monitor's screen is 5181b0 and
    // 6190c0 interleaved, a gradient faked from two palette slots.
    const midpoint: [number, number, number] = [0x59, 0x88, 0xb8];
    const indices = mapImageToPalette(flat(8, 8, midpoint), TWO_BLUES);
    expect(indices.filter((i) => i === 1)).toHaveLength(32);
    expect(indices.filter((i) => i === 2)).toHaveLength(32);
  });

  it('leans toward whichever entry the colour is closer to', () => {
    // Density has to track position along the blend, or a gradient dithers evenly
    // everywhere and reads as one flat mixture instead of a ramp.
    const secondCount = (rgb: [number, number, number]) =>
      mapImageToPalette(flat(8, 8, rgb), TWO_BLUES).filter((i) => i === 2).length;
    expect(secondCount([0x53, 0x83, 0xb2])).toBeLessThan(secondCount([0x59, 0x88, 0xb8]));
    expect(secondCount([0x59, 0x88, 0xb8])).toBeLessThan(secondCount([0x5f, 0x8e, 0xbe]));
  });

  it('places the two colours in a checkerboard rather than in stripes', () => {
    // Which colour lands on which square is arbitrary; that they alternate is not.
    const indices = mapImageToPalette(flat(4, 1, [0x59, 0x88, 0xb8]), TWO_BLUES);
    expect(new Set(indices)).toEqual(new Set([1, 2]));
    for (let i = 1; i < indices.length; i++) expect(indices[i]).not.toBe(indices[i - 1]);
  });

  it('still leaves undrawn pixels transparent', () => {
    const image = solidImage(4, 4, [0x59, 0x88, 0xb8, 0]);
    expect(mapImageToPalette(image, TWO_BLUES).every((i) => i === 0)).toBe(true);
  });

  it('does not dither between two entries that are far apart in colour', () => {
    // A checkerboard only reads as a blended tone when its two colours are close.
    // GlowIcons never spans further than about 27 in RGB — its dithered monitor
    // screen is 5181b0 against 6190c0. Alternating a red with an orange instead
    // reads as speckle, which is what a too-small palette produced on the folder
    // icons: yellow dots scattered over a red sheet of paper.
    const farApart: [number, number, number][] = [[0, 0, 0], [200, 90, 90], [230, 175, 100]];
    const indices = mapImageToPalette(flat(8, 8, [210, 110, 92]), farApart);
    expect(new Set(indices)).toEqual(new Set([1]));
  });

  it('never dithers into the reserved transparent slot', () => {
    // Index 0 is a hole, not a colour. A dark pixel blending toward it would punch
    // gaps in solid artwork.
    const palette: [number, number, number][] = [[0, 0, 0], [8, 8, 8], [240, 240, 240]];
    expect(mapImageToPalette(flat(8, 8, [4, 4, 4]), palette).every((i) => i !== 0)).toBe(true);
  });
});

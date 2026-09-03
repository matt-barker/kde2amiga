import { describe, it, expect } from 'vitest';

function solid(width: number, height: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
}
import JSZip from 'jszip';
import { runConversionJob, decodeThemeIcon, prepareIcon, glowMarginPx, type JobConfig } from './convertJob';
import { glowRadiusFor, glowRamp, GLOWICONS_RAMP } from '../image/selectedState';
import type { IconVariant } from '../theme/themeParser';

describe('runConversionJob', () => {
  it('returns one converted icon per input, carrying any system-default role', async () => {
    const zip = new JSZip();
    zip.file('scalable/places/folder.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#0000ff"/></svg>');
    zip.file('scalable/apps/firefox.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#ff8800"/></svg>');

    const folderIcon: IconVariant = { name: 'folder', category: 'places', sizePx: 0, format: 'svg', zipPath: 'scalable/places/folder.svg' };
    const firefoxIcon: IconVariant = { name: 'firefox', category: 'apps', sizePx: 0, format: 'svg', zipPath: 'scalable/apps/firefox.svg' };

    const converted = await runConversionJob(
      zip,
      [
        { icon: folderIcon, kind: 'drawer', role: 'drawer' },
        { icon: firefoxIcon, kind: 'tool' },
      ],
      { outputSizePx: 32, maxColors: 16, selectedEffect: 'invert' },
    );

    // The job stops at converted icons now; turning those into archive paths belongs to
    // outputEntries, which both the zip and the LHA builder share.
    expect(converted.map((icon) => icon.name)).toEqual(['folder', 'firefox']);
    expect(converted.find((icon) => icon.name === 'folder')?.role).toBe('drawer');
    expect(converted.find((icon) => icon.name === 'firefox')?.role).toBeUndefined();
    expect(converted.every((icon) => icon.infoBytes.length > 0)).toBe(true);
  });

  it('skips an icon that fails to decode without aborting the batch', async () => {
    const zip = new JSZip();
    zip.file('scalable/apps/broken.svg', 'not actually valid svg content <<<');
    zip.file('scalable/apps/ok.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#00ff00"/></svg>');

    const brokenIcon: IconVariant = { name: 'broken', category: 'apps', sizePx: 0, format: 'svg', zipPath: 'scalable/apps/broken.svg' };
    const okIcon: IconVariant = { name: 'ok', category: 'apps', sizePx: 0, format: 'svg', zipPath: 'scalable/apps/ok.svg' };

    const progressLog: Array<[number, number]> = [];
    const converted = await runConversionJob(
      zip,
      [{ icon: brokenIcon, kind: 'tool' }, { icon: okIcon, kind: 'tool' }],
      { outputSizePx: 32, maxColors: 16, selectedEffect: 'invert' },
      (done, total) => progressLog.push([done, total]),
    );

    expect(converted.map((icon) => icon.name)).toEqual(['ok']);
    expect(progressLog[progressLog.length - 1]).toEqual([2, 2]);
  });

  it('exposes per-icon decode and preparation for previews', async () => {
    const zip = new JSZip();
    // Red and its own inverse, cyan. selectedState.ts's nearestPaletteIndex reserves
    // index 0 for transparency and never remaps a foreground pixel onto it, so a
    // palette holding one foreground colour would leave invert with nowhere to go and
    // the assertion below vacuous. Palettes are per icon now, so the fixture has to
    // carry both colours rather than the test injecting them.
    zip.file('t/32/apps/a.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="16" fill="#ff0000"/><rect y="16" width="32" height="16" fill="#00ffff"/></svg>');

    const image = await decodeThemeIcon(
      zip,
      { name: 'a', category: 'apps', sizePx: 32, format: 'svg', zipPath: 't/32/apps/a.svg' },
      32,
    );
    expect(image.width).toBe(32);
    expect(image.height).toBe(32);

    const { normal, selected } = prepareIcon(image, {
      outputSizePx: 32, maxColors: 8, selectedEffect: 'invert',
    });

    expect(normal).toHaveLength(32 * 32);
    expect(selected).toHaveLength(32 * 32);
    expect(selected).not.toEqual(normal); // invert must actually change something
  });

  it('builds the palette from the one icon it is given', () => {
    // Batch-wide palettes are what the 34-entry ceiling made so costly.
    const red = solid(4, 4, [255, 0, 0, 255]);
    const { palette } = prepareIcon(red, { outputSizePx: 4, maxColors: 8, selectedEffect: 'invert' });
    expect(palette[0]).toEqual([0, 0, 0]); // reserved transparent slot
    for (const entry of palette.slice(1)) expect(entry).toEqual([255, 0, 0]);
  });

  it('bakes a soft edge onto the configured background', () => {
    // 1-bit alpha cannot anti-alias a silhouette, so smoothing it means compositing
    // the fringe against the backdrop the icon will sit on.
    const image = solid(1, 1, [0, 0, 0, 128]);
    const { palette, normal } = prepareIcon(image, {
      outputSizePx: 1, maxColors: 8, selectedEffect: 'invert', backgroundColor: [0xab, 0xab, 0xab],
    });
    expect(normal[0]).not.toBe(0); // drawn, not dropped
    expect(palette[normal[0]]).toEqual([85, 85, 85]); // blended halfway to the grey
  });

  it('leaves the edge hard when no background is configured', () => {
    const image = solid(1, 1, [0, 0, 0, 128]);
    const { palette, normal } = prepareIcon(image, {
      outputSizePx: 1, maxColors: 8, selectedEffect: 'invert',
    });
    expect(palette[normal[0]]).toEqual([0, 0, 0]); // the source colour, unblended
  });
});

describe('glow surround colour', () => {
  /** One opaque pixel in the middle of a 3x3 transparent field, for the glow to grow into. */
  function dotOnTransparent() {
    const data = new Uint8ClampedArray(3 * 3 * 4);
    data.set([255, 0, 0, 255], (1 * 3 + 1) * 4);
    return { width: 3, height: 3, data };
  }

  /** One opaque pixel centred in a 48px field — the size at which the halo gets all 4 rings. */
  function dotOnHaloSizedField() {
    const size = 48;
    const data = new Uint8ClampedArray(size * size * 4);
    data.set([255, 0, 0, 255], (24 * size + 24) * 4);
    return { width: size, height: size, data };
  }

  it('reserves a slot for every stop of the ramp so the halo is drawn exactly', () => {
    // Green is nowhere in a red icon, and neither are the stops derived from it, so
    // without reserved slots the halo would snap to whatever reds the median cut made.
    const { palette, selected } = prepareIcon(dotOnHaloSizedField(), {
      outputSizePx: 48, maxColors: 8, selectedEffect: 'glowSurround', glowColor: [0, 128, 0],
    });
    const ramp = glowRamp([0, 128, 0]);
    for (const stop of ramp) expect(palette).toContainEqual(stop);
    expect([1, 2, 3].map((d) => palette[selected[24 * 48 + 24 + d]])).toEqual(ramp);
  });

  it('reserves the GlowIcons ramp when no colour is chosen', () => {
    // The default halo is GlowIcons' own white/yellow/gold, which a red icon's palette
    // would otherwise have no way to express.
    const { palette, selected } = prepareIcon(dotOnHaloSizedField(), {
      outputSizePx: 48, maxColors: 8, selectedEffect: 'glowSurround',
    });
    for (const stop of GLOWICONS_RAMP) expect(palette).toContainEqual(stop);
    expect([1, 2, 3].map((d) => palette[selected[24 * 48 + 24 + d]])).toEqual(GLOWICONS_RAMP);
  });

  it('keeps the reserved slot inside the configured colour ceiling', () => {
    const { palette } = prepareIcon(dotOnHaloSizedField(), {
      outputSizePx: 48, maxColors: 6, selectedEffect: 'glowSurround', glowColor: [0, 128, 0],
    });
    expect(palette.length).toBeLessThanOrEqual(6);
  });

  it('reserves nothing when the effect is not glow surround', () => {
    const { palette } = prepareIcon(dotOnTransparent(), {
      outputSizePx: 3, maxColors: 8, selectedEffect: 'invert', glowColor: [0, 255, 0],
    });
    expect(palette).not.toContainEqual([0, 255, 0]);
  });
});

describe('glowMarginPx', () => {
  const base: JobConfig = { outputSizePx: 48, maxColors: 16, selectedEffect: 'glowSurround' };

  it('reserves exactly the halo it is about to draw', () => {
    // Preview and conversion both derive their margin here. If they ever disagreed the
    // preview would stop matching what lands on the Amiga, which is the one promise the
    // pixel-identity test exists to keep.
    expect(glowMarginPx(base)).toBe(glowRadiusFor(48));
  });

  it('tracks the output size', () => {
    expect([24, 32, 48, 64].map((outputSizePx) => glowMarginPx({ ...base, outputSizePx })))
      .toEqual([2, 3, 4, 5]);
  });

  it('reserves nothing when no halo is being drawn', () => {
    // Every other effect recolours pixels in place, so taking room from the artwork
    // would shrink icons for nothing.
    expect(glowMarginPx({ ...base, selectedEffect: 'invert' })).toBe(0);
  });
});

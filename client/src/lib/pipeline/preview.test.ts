import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildPreviews } from './preview';
import { runConversionJob } from './convertJob';
import { decodeInfoFileForTest } from '../newicons/diskObjectDecoderForTest';
import { buildInfoFile } from '../newicons/diskObject';
import type { IconVariant } from '../theme/themeParser';

const RED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ff0000"/></svg>';

// Index 0 in any palette is reserved for transparency. A solid single-colour icon
// therefore quantizes to exactly one foreground palette slot, and a recolouring
// selected-state effect can produce no visible difference when there's nowhere else to
// remap to (see task-9's note on this). This icon carries two foreground colours, so it
// stays a fair fixture whichever effect is asked for.
const TWO_COLOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" fill="#ff0000"/>' +
  '<rect x="8" y="8" width="16" height="16" fill="#0000ff"/>' +
  '</svg>';

function variant(name: string): IconVariant {
  return { name, category: 'apps', sizePx: 32, format: 'svg', zipPath: `t/32/apps/${name}.svg` };
}

describe('buildPreviews', () => {
  it('renders normal and selected states at the configured size', async () => {
    const zip = new JSZip();
    zip.file('t/32/apps/a.svg', TWO_COLOR_SVG);

    const previews = await buildPreviews(zip, [variant('a')], {
      outputSizePx: 32, maxColors: 8, selectedEffect: 'glowSurround',
    });

    expect(previews).toHaveLength(1);
    expect(previews[0].zipPath).toBe('t/32/apps/a.svg');
    expect(previews[0].normal.width).toBe(32);
    expect(previews[0].selected.width).toBe(32);
    expect(Array.from(previews[0].normal.data)).not.toEqual(Array.from(previews[0].selected.data));
  });

  it('gives each icon its own palette, so the selection does not colour its neighbours', async () => {
    const zip = new JSZip();
    zip.file('t/32/apps/a.svg', RED_SVG);
    zip.file(
      't/32/apps/b.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0000ff"/></svg>',
    );

    const [together] = await buildPreviews(zip, [variant('a'), variant('b')], {
      outputSizePx: 32, maxColors: 2, selectedEffect: 'darken',
    });
    const [alone] = await buildPreviews(zip, [variant('a')], {
      outputSizePx: 32, maxColors: 2, selectedEffect: 'darken',
    });

    // A NewIcons .info carries its own palette, so sharing one across the batch was
    // our choice, not the format's — and an expensive one: the ceiling is 34 entries
    // for the whole selection, which left gradient-heavy icons on about a dozen
    // colours and banding hard. Per icon, the same icons get the full 34. The red
    // icon must now map identically whether or not a blue one is selected beside it.
    expect(Array.from(together.normal.data)).toEqual(Array.from(alone.normal.data));
  });

  it('skips icons missing from the zip rather than failing the batch', async () => {
    const zip = new JSZip();
    zip.file('t/32/apps/a.svg', RED_SVG);

    const previews = await buildPreviews(zip, [variant('a'), variant('missing')], {
      outputSizePx: 32, maxColors: 8, selectedEffect: 'darken',
    });

    expect(previews.map((p) => p.zipPath)).toEqual(['t/32/apps/a.svg']);
  });
});

/**
 * Repaints palette indices as RGBA the way NewIcons defines them: index 0 is the
 * reserved transparent slot, everything else is its palette colour, fully opaque.
 *
 * Deliberately a second, independent implementation rather than an import of
 * preview.ts's own `toImageData`. Reusing that function would make the comparison
 * below self-referential — the exact failure mode this project has already paid for
 * once, when a round-trip through our own decoder hid a broken encoder behind 63
 * green tests. Here the *other* side of the comparison comes from
 * `decodeInfoFileForTest`, a faithful port of an upstream NewIcons decoder reading
 * real .info bytes.
 */
function paintIndices(
  indices: number[],
  palette: [number, number, number][],
  width: number,
  height: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < width * height; i++) {
    const index = indices[i];
    if (index === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const [r, g, b] = palette[index] ?? [0, 0, 0];
    out.push(r, g, b, 255);
  }
  return out;
}

/**
 * The branch's Global Constraint: "preview output is pixel-identical to conversion output".
 *
 * It holds today only by convention — preview.ts and convertJob.ts each independently call
 * `buildSharedPalette` and then `paletteIndicesFor`, in that order. Nothing detected the day
 * someone added a stage to one path and not the other. This does: it runs the real
 * conversion, reads the .info bytes back out of the real output zip with the upstream-ported
 * decoder, and compares them to what `buildPreviews` rendered from the same inputs.
 */
describe('preview / conversion pixel identity', () => {
  const THREE_COLOR_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="#ff0000"/>' +
    '<rect x="4" y="4" width="24" height="24" fill="#0000ff"/>' +
    '<rect x="10" y="10" width="12" height="12" fill="#00ff00"/>' +
    '</svg>';
  const OTHER_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="#ffcc00"/>' +
    '<rect x="6" y="6" width="20" height="20" fill="#004466"/>' +
    '</svg>';

  it('renders exactly the pixels and palette the .info file carries, in both states', async () => {
    const zip = new JSZip();
    zip.file('t/32/apps/a.svg', THREE_COLOR_SVG);
    zip.file('t/32/apps/b.svg', OTHER_SVG);

    const config = { outputSizePx: 32, maxColors: 8, selectedEffect: 'glowSurround' as const };
    const variants = [variant('a'), variant('b')];

    const previews = await buildPreviews(zip, variants, config);
    const converted = await runConversionJob(
      zip,
      variants.map((icon) => ({ icon, kind: 'project' as const })),
      config,
    );

    expect(previews).toHaveLength(2);

    for (const v of variants) {
      const entry = converted.find((icon) => icon.name === v.name);
      expect(entry).toBeDefined();
      const decoded = decodeInfoFileForTest(
        buildInfoFile({
          width: entry!.width,
          height: entry!.height,
          kind: entry!.kind,
          normal: entry!.normal,
          selected: entry!.selected,
        }),
      );
      const preview = previews.find((p) => p.zipPath === v.zipPath)!;

      expect([decoded.width, decoded.height]).toEqual([preview.width, preview.height]);
      // Both states of one icon must share one palette, and it must be the batch palette.
      expect(decoded.selected.palette).toEqual(decoded.normal.palette);
      // Guard against a vacuous comparison: index 0 is reserved for transparency, so a
      // palette with fewer than three entries leaves the effect only one foreground slot
      // to land on and normal/selected could not differ however wrong the code was.
      expect(decoded.normal.palette.length).toBeGreaterThanOrEqual(3);

      expect(Array.from(preview.normal.data)).toEqual(
        paintIndices(decoded.normal.pixels, decoded.normal.palette, decoded.width, decoded.height),
      );
      // The selected state is pinned explicitly: it runs through an extra stage
      // (applySelectedStateEffect) and is where the two paths could most plausibly drift.
      expect(Array.from(preview.selected.data)).toEqual(
        paintIndices(decoded.selected.pixels, decoded.selected.palette, decoded.width, decoded.height),
      );
      expect(Array.from(preview.selected.data)).not.toEqual(Array.from(preview.normal.data));
    }
  });
});

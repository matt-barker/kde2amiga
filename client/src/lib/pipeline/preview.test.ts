import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildPreviews } from './preview';
import type { IconVariant } from '../theme/themeParser';

const RED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ff0000"/></svg>';

// Index 0 in any palette is reserved for transparency. A solid single-colour icon
// therefore quantizes to exactly one foreground palette slot, and no selected-state
// effect can produce a visible difference when there's nowhere else to remap to
// (see task-9's note on this). This icon carries two foreground colours so `invert`
// has a second palette slot to snap onto.
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
      outputSizePx: 32, maxColors: 8, selectedEffect: 'invert',
    });

    expect(previews).toHaveLength(1);
    expect(previews[0].zipPath).toBe('t/32/apps/a.svg');
    expect(previews[0].normal.width).toBe(32);
    expect(previews[0].selected.width).toBe(32);
    expect(Array.from(previews[0].normal.data)).not.toEqual(Array.from(previews[0].selected.data));
  });

  it('shares one palette across the whole selection, as conversion does', async () => {
    const zip = new JSZip();
    zip.file('t/32/apps/a.svg', RED_SVG);
    zip.file(
      't/32/apps/b.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0000ff"/></svg>',
    );

    const [together] = await buildPreviews(zip, [variant('a'), variant('b')], {
      outputSizePx: 32, maxColors: 2, selectedEffect: 'invert',
    });
    const [alone] = await buildPreviews(zip, [variant('a')], {
      outputSizePx: 32, maxColors: 2, selectedEffect: 'invert',
    });

    // With only two palette slots, adding a blue icon must change how the red one maps.
    // This is the batch-wide-palette coupling the spec calls out.
    expect(Array.from(together.normal.data)).not.toEqual(Array.from(alone.normal.data));
  });

  it('skips icons missing from the zip rather than failing the batch', async () => {
    const zip = new JSZip();
    zip.file('t/32/apps/a.svg', RED_SVG);

    const previews = await buildPreviews(zip, [variant('a'), variant('missing')], {
      outputSizePx: 32, maxColors: 8, selectedEffect: 'invert',
    });

    expect(previews.map((p) => p.zipPath)).toEqual(['t/32/apps/a.svg']);
  });
});

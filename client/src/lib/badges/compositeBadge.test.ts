import { describe, it, expect } from 'vitest';
import { compositeBadge } from './compositeBadge';
import type { RgbaImage } from '../image/quantize';

function transparentImage(size: number): RgbaImage {
  return { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
}

const badgeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000000" d="M4 4h16v16H4z"/></svg>';

describe('compositeBadge', () => {
  it('returns an image the same size as the base', async () => {
    const base = transparentImage(32);
    const result = await compositeBadge(base, { svgText: badgeSvg, color: '#ff0000', corner: 'bottom-right', scale: 0.5 });
    expect(result.width).toBe(32);
    expect(result.height).toBe(32);
  });

  it('paints badge-colored pixels near the requested corner', async () => {
    const base = transparentImage(32);
    const result = await compositeBadge(base, { svgText: badgeSvg, color: '#ff0000', corner: 'bottom-right', scale: 0.5 });
    // bottom-right quadrant should now contain opaque red pixels
    const index = (28 * 32 + 28) * 4;
    expect(result.data[index]).toBeGreaterThan(200);
    expect(result.data[index + 3]).toBeGreaterThan(0);
  });

  it('leaves the top-left quadrant untouched when badge is bottom-right', async () => {
    const base = transparentImage(32);
    const result = await compositeBadge(base, { svgText: badgeSvg, color: '#ff0000', corner: 'bottom-right', scale: 0.5 });
    const index = (2 * 32 + 2) * 4;
    expect(result.data[index + 3]).toBe(0);
  });
});

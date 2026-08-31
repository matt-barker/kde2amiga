import { describe, it, expect } from 'vitest';
import { encodeNewIconState } from './newIconsEncoder';

describe('encodeNewIconState', () => {
  it('produces IM1= lines each no longer than 127 characters', () => {
    const width = 8;
    const height = 8;
    const palette: [number, number, number][] = [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [0, 255, 0],
    ];
    const pixels = new Array(width * height).fill(0).map((_, i) => i % palette.length);
    const lines = encodeNewIconState({ width, height, transparent: true, palette, pixels }, 'IM1=');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(127);
      expect(line.startsWith('IM1=')).toBe(true);
    }
  });

  it('encodes the header so width/height/colorCount/transparency round-trip', () => {
    const palette: [number, number, number][] = [
      [10, 20, 30],
      [200, 210, 220],
    ];
    const pixels = [0, 1, 1, 0];
    const lines = encodeNewIconState(
      { width: 2, height: 2, transparent: true, palette, pixels },
      'IM1=',
    );
    const headerPayload = lines[0].slice(4); // strip "IM1="
    expect(headerPayload.charCodeAt(0)).toBe(66); // 'B' -> transparent
    expect(headerPayload.charCodeAt(1) - 33).toBe(2); // width
    expect(headerPayload.charCodeAt(2) - 33).toBe(2); // height
    const colorCount = ((headerPayload.charCodeAt(3) - 33) << 6) + (headerPayload.charCodeAt(4) - 33);
    expect(colorCount).toBe(2);
  });
});

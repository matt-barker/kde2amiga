import { describe, it, expect } from 'vitest';
import { buildInfoFile } from './diskObject';
import { decodeInfoFileForTest } from './diskObjectDecoderForTest';
import type { NewIconState } from './newIconsEncoder';

function makeState(width: number, height: number): NewIconState {
  const palette: [number, number, number][] = [
    [0, 0, 0],
    [255, 255, 255],
    [200, 40, 40],
  ];
  const pixels = new Array(width * height).fill(0).map((_, i) => i % palette.length);
  return { width, height, transparent: true, palette, pixels };
}

describe('buildInfoFile', () => {
  it('starts with the 0xE310 magic number', () => {
    const bytes = buildInfoFile({
      width: 4,
      height: 4,
      kind: 'project',
      normal: makeState(4, 4),
      selected: makeState(4, 4),
    });
    expect(bytes[0]).toBe(0xe3);
    expect(bytes[1]).toBe(0x10);
  });

  it('round-trips icon type, dimensions, and both NewIcons image states', () => {
    const normal = makeState(4, 4);
    const selected = makeState(4, 4);
    const bytes = buildInfoFile({ width: 4, height: 4, kind: 'drawer', normal, selected });
    const decoded = decodeInfoFileForTest(bytes);

    expect(decoded.type).toBe(2); // drawer
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
    expect(decoded.normal.palette).toEqual(normal.palette);
    expect(decoded.normal.pixels).toEqual(normal.pixels);
    expect(decoded.selected.pixels).toEqual(selected.pixels);
  });

  it('round-trips a 32x32 icon whose payload spans multiple IM1=/IM2= lines', () => {
    function makeBigState(width: number, height: number): NewIconState {
      const palette: [number, number, number][] = Array.from({ length: 16 }, (_, i) => [
        i * 16,
        255 - i * 16,
        (i * 37) % 256,
      ]);
      const pixels = new Array(width * height).fill(0).map((_, i) => i % palette.length);
      return { width, height, transparent: false, palette, pixels };
    }

    const normal = makeBigState(32, 32);
    const selected = makeBigState(32, 32);
    const bytes = buildInfoFile({ width: 32, height: 32, kind: 'tool', normal, selected });
    const decoded = decodeInfoFileForTest(bytes);

    expect(decoded.width).toBe(32);
    expect(decoded.height).toBe(32);
    expect(decoded.normal.width).toBe(32);
    expect(decoded.normal.height).toBe(32);
    expect(decoded.normal.palette).toEqual(normal.palette);
    expect(decoded.normal.pixels).toEqual(normal.pixels);
    expect(decoded.selected.width).toBe(32);
    expect(decoded.selected.height).toBe(32);
    expect(decoded.selected.palette).toEqual(selected.palette);
    expect(decoded.selected.pixels).toEqual(selected.pixels);
  });
});

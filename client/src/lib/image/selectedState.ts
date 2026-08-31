export type SelectedStateEffect = 'invert' | 'brighten' | 'darken' | 'tint' | 'glowSurround';

type Rgb = [number, number, number];

function clamp(n: number): number {
  return Math.max(0, Math.min(255, n));
}

function nearestPaletteIndex(color: Rgb, palette: Rgb[]): number {
  let bestIndex = 0;
  let bestDistance = Infinity;
  palette.forEach((candidate, index) => {
    const distance =
      (candidate[0] - color[0]) ** 2 + (candidate[1] - color[1]) ** 2 + (candidate[2] - color[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function transformColor(effect: SelectedStateEffect, [r, g, b]: Rgb, tintColor?: Rgb): Rgb {
  switch (effect) {
    case 'invert':
      return [clamp(255 - r), clamp(255 - g), clamp(255 - b)];
    case 'brighten':
      return [clamp(r + 60), clamp(g + 60), clamp(b + 60)];
    case 'darken':
      return [clamp(r - 60), clamp(g - 60), clamp(b - 60)];
    case 'tint': {
      const [tr, tg, tb] = tintColor ?? [255, 255, 0];
      return [clamp((r + tr) / 2), clamp((g + tg) / 2), clamp((b + tb) / 2)];
    }
    case 'glowSurround':
      return [r, g, b]; // interior pixels unchanged; border handled separately below
  }
}

export function applySelectedStateEffect(
  effect: SelectedStateEffect,
  palette: Rgb[],
  pixels: number[],
  width: number,
  height: number,
  tintColor?: Rgb,
): number[] {
  const remapCache = new Map<number, number>();
  const remap = (index: number): number => {
    const cached = remapCache.get(index);
    if (cached !== undefined) return cached;
    const transformed = transformColor(effect, palette[index], tintColor);
    const newIndex = nearestPaletteIndex(transformed, palette);
    remapCache.set(index, newIndex);
    return newIndex;
  };

  const result = pixels.map(remap);

  if (effect === 'glowSurround') {
    const brightestIndex = palette.reduce(
      (best, color, index) => {
        const brightness = color[0] + color[1] + color[2];
        return brightness > best.brightness ? { index, brightness } : best;
      },
      { index: 0, brightness: -1 },
    ).index;

    const preGlow = result.slice();

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (preGlow[i] !== 0) continue; // only grow into background/transparent pixels
        const neighbors = [
          [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
        ];
        const touchesForeground = neighbors.some(([nx, ny]) => {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
          return preGlow[ny * width + nx] !== 0;
        });
        if (touchesForeground) result[i] = brightestIndex;
      }
    }
  }

  return result;
}

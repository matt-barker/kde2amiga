import { Canvas, Image, ImageData as NodeImageData } from 'canvas';

/**
 * jsdom has no real 2D rasterizer: its `<canvas>` elements and `Image`
 * constructor are stubs. This swaps in the `canvas` npm package's Node
 * implementation so tests that decode/draw/composite images get real pixel
 * output.
 *
 * Design notes (see task-11 report for the full story):
 * - `document.createElement('canvas')` is overridden to return the `canvas`
 *   package's own `Canvas` instance directly, rather than a jsdom element
 *   wrapping a freshly-created backing canvas on every `getContext` call.
 *   This keeps one stable backing buffer per element, so `putImageData`
 *   followed by `getImageData` on the same element round-trips correctly,
 *   and `ctx.drawImage(otherCanvasElement, x, y)` works because the "other
 *   canvas element" is already a valid `canvas`-package `Canvas`, which its
 *   own `drawImage` knows how to read as a source (a jsdom canvas element is
 *   not one).
 * - `globalThis.Image` is replaced with the `canvas` package's `Image`,
 *   which can decode data URLs (`data:image/svg+xml;base64,...` and
 *   `data:image/png;base64,...`) synchronously-enough to fire `onload`.
 * - `globalThis.ImageData` is replaced with the `canvas` package's
 *   `ImageData` so code that constructs `new ImageData(...)` (needed by
 *   Task 13's compositing) works under jsdom too.
 */
export function installCanvas(): void {
  const realCreateElement = document.createElement.bind(document);

  document.createElement = function (tagName: string, options?: unknown) {
    if (typeof tagName === 'string' && tagName.toLowerCase() === 'canvas') {
      return new Canvas(300, 150) as unknown as HTMLCanvasElement;
    }
    return realCreateElement(tagName as never, options as never);
  } as typeof document.createElement;

  (globalThis as unknown as { Image: typeof Image }).Image = Image;
  (globalThis as unknown as { ImageData: typeof NodeImageData }).ImageData = NodeImageData;
}

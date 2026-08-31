import { Canvas, Image, ImageData as NodeImageData } from 'canvas';

/**
 * jsdom has no real 2D rasterizer: its `<canvas>` elements and `Image`
 * constructor are stubs. This swaps in the `canvas` npm package's Node
 * implementation so tests that decode/draw/composite images get real pixel
 * output.
 *
 * Design notes (see task-11 report for the full story):
 * - jsdom canvas *elements* are left alone as real DOM nodes — we do NOT
 *   override `document.createElement('canvas')`. Components (e.g. the
 *   converted-icon preview grid) render literal `<canvas>` tags and
 *   Testing Library mounts them via `appendChild`/`style`/`setAttribute`;
 *   those only exist on real jsdom nodes, not on a bare `canvas`-package
 *   `Canvas` object. So the element identity has to stay a genuine
 *   `HTMLCanvasElement`.
 * - What's missing is real rasterization, so instead we patch
 *   `HTMLCanvasElement.prototype.getContext` to hand back a context backed
 *   by a `canvas`-package `Canvas`, one per element, held in a `WeakMap`.
 *   `backingFor(el)` creates that backing `Canvas` on first use and
 *   re-syncs its `width`/`height` from the element on every call, so code
 *   that does `canvas.width = 32` *then* `getContext('2d')` — which is
 *   exactly what `decode.ts` and Task 13's compositing both do — gets a
 *   correctly-sized buffer. Reusing the same backing `Canvas` for a given
 *   element is what makes `putImageData` followed by `getImageData` on
 *   that element round-trip correctly.
 * - The returned 2D context's `drawImage` is wrapped so that any source
 *   argument which is itself an `HTMLCanvasElement` is swapped for its
 *   backing `canvas`-package `Canvas` before delegating. node-canvas's
 *   `drawImage` cannot read a jsdom canvas element as a source (it has no
 *   pixel data node-canvas understands), but it can read the backing
 *   `Canvas` for that element. `Image` sources pass through untouched.
 * - `globalThis.Image` is replaced with the `canvas` package's `Image`,
 *   which can decode data URLs (`data:image/svg+xml;base64,...` and
 *   `data:image/png;base64,...`) and fire `onload`.
 * - `globalThis.ImageData` is replaced with the `canvas` package's
 *   `ImageData` so code that constructs `new ImageData(...)` (needed by
 *   Task 13's compositing) works under jsdom too.
 */
export function installCanvas(): void {
  const backing = new WeakMap<HTMLCanvasElement, Canvas>();

  function backingFor(el: HTMLCanvasElement): Canvas {
    let c = backing.get(el);
    if (!c) {
      c = new Canvas(el.width, el.height);
      backing.set(el, c);
    }
    // Keep the backing buffer's dimensions in sync with the element in
    // case `width`/`height` were assigned after the first getContext call.
    if (c.width !== el.width) c.width = el.width;
    if (c.height !== el.height) c.height = el.height;
    return c;
  }

  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    ...args: unknown[]
  ) {
    if (type !== '2d') {
      // Only 2D rasterization is exercised by this codebase.
      return null;
    }
    const nodeCanvas = backingFor(this);
    const ctx = nodeCanvas.getContext('2d', ...(args as []));
    const realDrawImage = ctx.drawImage.bind(ctx);
    ctx.drawImage = function (source: unknown, ...rest: unknown[]) {
      const resolvedSource =
        source instanceof HTMLCanvasElement ? backingFor(source) : source;
      return (realDrawImage as (...a: unknown[]) => unknown)(resolvedSource, ...rest);
    } as typeof ctx.drawImage;
    return ctx;
  } as typeof HTMLCanvasElement.prototype.getContext;

  (globalThis as unknown as { Image: typeof Image }).Image = Image;
  (globalThis as unknown as { ImageData: typeof NodeImageData }).ImageData = NodeImageData;
}

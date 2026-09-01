type Callback = () => void;

const callbacks = new Set<Callback>();

/**
 * jsdom ships no ResizeObserver, and IconGallery uses one to derive its grid column
 * count from the container's width.
 *
 * The stub deliberately never fires on its own: jsdom lays nothing out, so a faithful
 * implementation could only ever report a width of 0 and no test could distinguish a
 * working measurement from a broken one. Instead a test pins `clientWidth` on the
 * element and calls `triggerResizeObservers()` to stand in for the layout change,
 * which exercises the component's real observer wiring rather than only its
 * mount-time measurement.
 */
export function installResizeObserver(): void {
  globalThis.ResizeObserver = class {
    private readonly callback: Callback;

    constructor(callback: Callback) {
      this.callback = callback;
    }

    observe() {
      callbacks.add(this.callback);
    }

    unobserve() {
      callbacks.delete(this.callback);
    }

    disconnect() {
      callbacks.delete(this.callback);
    }
  } as unknown as typeof ResizeObserver;
}

export function triggerResizeObservers(): void {
  for (const callback of callbacks) callback();
}

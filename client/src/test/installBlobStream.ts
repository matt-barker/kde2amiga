/**
 * jsdom's `Blob` (and therefore `File`, which extends it) has no `.stream()`
 * method — real browsers do. `ThemeLoader` streams the uploaded `File` straight
 * into `loadArchive` rather than buffering it into memory first, so tests need
 * a working `.stream()` under jsdom too. This builds it from `arrayBuffer()`,
 * which jsdom does implement, and enqueues the whole thing as one chunk.
 */
export function installBlobStream(): void {
  if (typeof Blob.prototype.stream === 'function') return;

  // Cast needed because lib.dom's Blob.stream() is typed to return
  // ReadableStream<Uint8Array<ArrayBuffer>>, a generic narrower than the
  // plain Uint8Array this polyfill builds — harmless at runtime.
  Blob.prototype.stream = function (this: Blob) {
    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const buffer = await this.arrayBuffer();
        controller.enqueue(new Uint8Array(buffer));
        controller.close();
      },
    });
  } as typeof Blob.prototype.stream;
}

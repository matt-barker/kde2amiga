/**
 * jsdom's `Blob` (and therefore `File`, which extends it) has no `.stream()`
 * method — real browsers do. `ThemeLoader` streams the uploaded `File` straight
 * into `loadArchive` rather than buffering it into memory first, so tests need
 * a working `.stream()` under jsdom too. This builds it from `arrayBuffer()`,
 * which jsdom does implement, and enqueues the whole thing as one chunk.
 *
 * Limitation: this polyfill fully buffers the Blob via `arrayBuffer()` before
 * handing back a single-chunk stream, so it cannot tell a genuinely
 * incremental consumer apart from one that buffers and re-wraps. Tests that
 * run under this polyfill only prove callers use the streaming API *shape*
 * (`Blob.stream()` → `ReadableStream`) — they are not evidence that the
 * pipeline never buffers a whole file in memory. That guarantee is
 * architectural: `ThemeLoader`'s hot path (`handleFileChange` /
 * `handleFetchUrl`) never calls `.arrayBuffer()` on the file or response, and
 * `loadArchive`/`untarStream` in `archive.ts` stream tar entries rather than
 * materialising the whole archive. Verify no-buffering by reading that code
 * path, not by trusting a green run of tests that use this polyfill.
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

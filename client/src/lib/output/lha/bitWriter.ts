/**
 * Bit output for `-lh5-`, packed most-significant-bit first.
 *
 * That order is the opposite of deflate's, and it is the single easiest thing to get
 * backwards when adapting LZ77 code written for zip: an lh5 stream packed LSB-first
 * decodes to plausible-looking garbage rather than failing loudly.
 *
 * Deliberately not `BitWriter` from ../../newicons/sevenBitCodec, which emits 7-bit
 * groups for NewIcons tooltypes — a different format that happens to share a name.
 */
export class LhaBitWriter {
  private bytes: number[] = [];
  private current = 0;
  private filled = 0;

  putBits(count: number, value: number): void {
    for (let bit = count - 1; bit >= 0; bit--) {
      this.current = (this.current << 1) | ((value >>> bit) & 1);
      this.filled++;
      if (this.filled === 8) {
        this.bytes.push(this.current & 0xff);
        this.current = 0;
        this.filled = 0;
      }
    }
  }

  toBytes(): Uint8Array {
    if (this.filled === 0) return Uint8Array.from(this.bytes);
    // The final byte is zero-padded on the right; a decoder stops on the code count
    // in the block header, so the padding is never mistaken for another code.
    return Uint8Array.from([...this.bytes, (this.current << (8 - this.filled)) & 0xff]);
  }
}

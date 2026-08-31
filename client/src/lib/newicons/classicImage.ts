export function packClassicImageBitplane(width: number, height: number, selected: boolean): Uint8Array {
  const rowBytes = (((width + 15) >> 4) << 1);
  const out = new Uint8Array(rowBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      let bit = isBorder ? 1 : 0;
      if (selected) bit = bit ^ 1;
      if (bit) {
        const byteIndex = y * rowBytes + (x >> 3);
        const bitIndex = 7 - (x & 7);
        out[byteIndex] |= 1 << bitIndex;
      }
    }
  }
  // Padding bits (x >= width, up to the row byte boundary) are left as 0,
  // except when selected inverts everything including the pad columns —
  // real Amiga software ignores pad-column bits, but keep them consistent
  // with the "invert" framing for clarity when the buffer is inspected.
  if (selected) {
    for (let y = 0; y < height; y++) {
      for (let x = width; x < rowBytes * 8; x++) {
        const byteIndex = y * rowBytes + (x >> 3);
        const bitIndex = 7 - (x & 7);
        out[byteIndex] |= 1 << bitIndex;
      }
    }
  }
  return out;
}

export class BinaryWriter {
  private chunks: number[] = [];

  writeUByte(value: number): void {
    this.chunks.push(value & 0xff);
  }

  writeWord(value: number): void {
    this.chunks.push((value >>> 8) & 0xff, value & 0xff);
  }

  writeDWord(value: number): void {
    this.chunks.push(
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  }

  writeLong(value: number): void {
    // Same bit layout as writeDWord; kept as a distinct name for call-site clarity
    // when a field is conceptually signed (e.g. currentX/currentY).
    this.writeDWord(value >>> 0);
  }

  writeString(value: string): void {
    for (let i = 0; i < value.length; i++) {
      this.chunks.push(value.charCodeAt(i) & 0xff);
    }
  }

  writeBytes(bytes: Uint8Array): void {
    for (const b of bytes) this.chunks.push(b);
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

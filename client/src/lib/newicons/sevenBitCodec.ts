export class BitWriter {
  private bits: number[] = []; // one 0/1 per element, MSB-first per pushBits call

  pushBits(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i--) {
      this.bits.push((value >>> i) & 1);
    }
  }

  toSevenBitGroups(): number[] {
    const groups: number[] = [];
    for (let i = 0; i < this.bits.length; i += 7) {
      let group = 0;
      for (let j = 0; j < 7; j++) {
        group = (group << 1) | (this.bits[i + j] ?? 0);
      }
      groups.push(group);
    }
    return groups;
  }
}

export function encodeSevenBitGroups(groups: number[]): string {
  let out = '';
  for (const value of groups) {
    const byte = value <= 79 ? value + 32 : value + 81;
    out += String.fromCharCode(byte);
  }
  return out;
}

/** Literal-only inverse of encodeSevenBitGroups, for round-trip tests only. */
export function decodeSevenBitGroupsForTest(encoded: string): number[] {
  const groups: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    const byte = encoded.charCodeAt(i);
    groups.push(byte < 160 ? byte - 32 : byte - 81);
  }
  return groups;
}

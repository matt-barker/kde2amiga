/**
 * Huffman code-length assignment and canonical code numbering for `-lh5-`.
 *
 * The canonical ordering here is not a free choice: Lhasa's `build_tree` walks symbol
 * indices ascending at each depth and hands out the next free slot, so the lowest-indexed
 * symbol of a given length must take the lowest code of that length. Any other numbering
 * decodes to a different symbol rather than to an error.
 */

/**
 * Code lengths minimising total encoded size, with none longer than `maxLength`.
 *
 * The limit is a format constraint, not a tuning knob: the code table writes each length
 * as `length + 2` into a 19-symbol alphabet, so a 17-bit code has no representation at all.
 *
 * Over-long codes are resolved by halving all frequencies and rebuilding, which flattens
 * the distribution until it fits. That costs a little ratio on pathological inputs and is
 * far simpler to keep correct than package-merge; on icon data it never triggers.
 */
export function huffmanCodeLengths(freqs: number[], maxLength: number): number[] {
  let working = freqs.slice();

  for (;;) {
    const lengths = buildLengths(working);
    if (Math.max(0, ...lengths) <= maxLength) return lengths;
    working = working.map((f) => (f > 0 ? Math.max(1, f >> 1) : 0));
  }
}

function buildLengths(freqs: number[]): number[] {
  const lengths = new Array<number>(freqs.length).fill(0);
  const used = freqs.map((f, symbol) => ({ f, symbol })).filter((e) => e.f > 0);

  if (used.length === 0) return lengths;
  // A lone symbol still needs a bit: Lhasa reaches zero-length codes only through the
  // table's "single code" special form, which this encoder never writes.
  if (used.length === 1) {
    lengths[used[0].symbol] = 1;
    return lengths;
  }

  // Standard two-queue Huffman. Nodes carry the set of symbols beneath them so that
  // depths can be counted without materialising a tree.
  type Node = { weight: number; symbols: number[] };
  const leaves: Node[] = used
    .sort((a, b) => a.f - b.f || a.symbol - b.symbol)
    .map((e) => ({ weight: e.f, symbols: [e.symbol] }));
  const merged: Node[] = [];
  let leafAt = 0;
  let mergedAt = 0;

  const takeSmallest = (): Node => {
    const takeLeaf =
      mergedAt >= merged.length ||
      (leafAt < leaves.length && leaves[leafAt].weight <= merged[mergedAt].weight);
    return takeLeaf ? leaves[leafAt++] : merged[mergedAt++];
  };

  while (leaves.length - leafAt + merged.length - mergedAt > 1) {
    const a = takeSmallest();
    const b = takeSmallest();
    for (const symbol of a.symbols) lengths[symbol]++;
    for (const symbol of b.symbols) lengths[symbol]++;
    merged.push({ weight: a.weight + b.weight, symbols: [...a.symbols, ...b.symbols] });
  }

  return lengths;
}

/**
 * Canonical code values for a set of lengths, matching Lhasa's tree construction:
 * codes ascend within a length in symbol order, and shift left between lengths.
 *
 * Unused symbols (length 0) take no code and are returned as 0; callers must consult
 * the lengths, never the codes, to know whether a symbol is present.
 */
export function canonicalCodes(lengths: number[]): number[] {
  const codes = new Array<number>(lengths.length).fill(0);
  const maxLength = Math.max(0, ...lengths);
  let code = 0;

  for (let length = 1; length <= maxLength; length++) {
    for (let symbol = 0; symbol < lengths.length; symbol++) {
      if (lengths[symbol] === length) codes[symbol] = code++;
    }
    code <<= 1;
  }

  return codes;
}

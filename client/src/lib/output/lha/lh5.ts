import { LhaBitWriter } from './bitWriter';
import { huffmanCodeLengths, canonicalCodes } from './huffman';
import { lzssCompress, LH5_MIN_MATCH, type LzToken } from './lzss';

/**
 * `-lh5-` block encoder.
 *
 * Every constant and field width here is the mirror of Lhasa's lh_new_decoder.c /
 * lh5_decoder.c, which is the reference implementation `lha` itself uses. Where a
 * comment cites a decoder function, that function is what this code has to satisfy.
 */

/** Literal/length alphabet: 256 literals, then lengths 3..256. NUM_CODES in lh5_decoder.c. */
const NUM_CODES = 510;
/** Offset symbols 0..14, each naming the *bit width* of the offset that follows. */
const MAX_OFFSET_CODES = 15;
/** Code lengths 1..16 plus the three skip codes: read_code_table's `code - 2`. */
const NUM_TEMP_CODES = 19;
/** OFFSET_BITS in lh5_decoder.c: the width of the offset-table entry count. */
const OFFSET_BITS = 4;
/** TEMP_CODE_BITS in lh_new_decoder.c. */
const TEMP_CODE_BITS = 5;
/** Lengths above this cannot be written: read_code_table encodes them as `length + 2`. */
const MAX_CODE_LENGTH = 16;
/** start_new_block writes the command count in 16 bits. */
const MAX_BLOCK_COMMANDS = 65535;

/** One entry of the run-length encoding of the code-length table. */
interface TempSymbol {
  symbol: number;
  extraBits: number;
  extraValue: number;
}

/**
 * The bit width read_offset_code expects for a given offset.
 *
 * It returns 0 for offset 0 and 1 for offset 1; above that a code of `bits` means
 * "read bits-1 more, then add 2^(bits-1)", covering [2^(bits-1), 2^bits - 1].
 */
function offsetWidth(offset: number): number {
  if (offset === 0) return 0;
  if (offset === 1) return 1;
  return 32 - Math.clz32(offset);
}

/** Inverse of read_length_value: 3 bits, or 3 set bits then a unary extension. */
function writeLengthValue(writer: LhaBitWriter, length: number): void {
  if (length < 7) {
    writer.putBits(3, length);
    return;
  }
  writer.putBits(3, 7);
  for (let i = 0; i < length - 7; i++) writer.putBits(1, 1);
  writer.putBits(1, 0);
}

/** Highest used symbol plus one — the entry count each table header declares. */
function usedCount(lengths: number[]): number {
  let count = lengths.length;
  while (count > 0 && lengths[count - 1] === 0) count--;
  return count;
}

/**
 * Run-length encodes the code-length table the way read_code_table decodes it.
 *
 * Runs of unused symbols become skip codes 0 (one), 1 (3-18) and 2 (20-531); a used
 * symbol becomes `length + 2`. A run of exactly 19 falls in the gap between the skip
 * ranges and is split, which is the sort of boundary that silently corrupts a table.
 */
function encodeCodeTable(lengths: number[], count: number): TempSymbol[] {
  const out: TempSymbol[] = [];
  let at = 0;

  while (at < count) {
    if (lengths[at] !== 0) {
      out.push({ symbol: lengths[at] + 2, extraBits: 0, extraValue: 0 });
      at++;
      continue;
    }

    let run = 0;
    while (at + run < count && lengths[at + run] === 0) run++;

    if (run <= 2) {
      for (let i = 0; i < run; i++) out.push({ symbol: 0, extraBits: 0, extraValue: 0 });
    } else if (run <= 18) {
      out.push({ symbol: 1, extraBits: 4, extraValue: run - 3 });
    } else if (run === 19) {
      // 19 is representable by neither range, so spend one single-skip and encode 18.
      out.push({ symbol: 0, extraBits: 0, extraValue: 0 });
      out.push({ symbol: 1, extraBits: 4, extraValue: 18 - 3 });
    } else {
      const chunk = Math.min(run, 531);
      out.push({ symbol: 2, extraBits: 9, extraValue: chunk - 20 });
      run = chunk;
    }
    at += run;
  }

  return out;
}

/** Inverse of read_temp_table, including its two-bit skip field after the third entry. */
function writeTempTable(writer: LhaBitWriter, lengths: number[]): void {
  const count = usedCount(lengths);
  writer.putBits(TEMP_CODE_BITS, count);
  for (let i = 0; i < count; i++) {
    writeLengthValue(writer, lengths[i]);
    // read_temp_table consumes two bits here whatever they say. We never skip, so the
    // remaining lengths are written out in full; omitting these bits desynchronises it.
    if (i === 2) writer.putBits(2, 0);
  }
}

/** Inverse of read_offset_table. Note it has no equivalent of the temp table's skip field. */
function writeOffsetTable(writer: LhaBitWriter, lengths: number[]): void {
  const count = usedCount(lengths);
  if (count === 0) {
    // No matches in this block, so no offset was ever coded. An empty table is not
    // legal; the "single code" form is how the format says "one code, zero bits".
    writer.putBits(OFFSET_BITS, 0);
    writer.putBits(OFFSET_BITS, 0);
    return;
  }
  writer.putBits(OFFSET_BITS, count);
  for (let i = 0; i < count; i++) writeLengthValue(writer, lengths[i]);
}

function writeBlock(writer: LhaBitWriter, tokens: LzToken[]): void {
  const codeFreqs = new Array<number>(NUM_CODES).fill(0);
  const offsetFreqs = new Array<number>(MAX_OFFSET_CODES).fill(0);

  for (const token of tokens) {
    if (token.kind === 'literal') {
      codeFreqs[token.byte]++;
    } else {
      codeFreqs[256 + token.length - LH5_MIN_MATCH]++;
      offsetFreqs[offsetWidth(token.distance - 1)]++;
    }
  }

  const codeLengths = huffmanCodeLengths(codeFreqs, MAX_CODE_LENGTH);
  const codeValues = canonicalCodes(codeLengths);
  const offsetLengths = huffmanCodeLengths(offsetFreqs, MAX_CODE_LENGTH);
  const offsetValues = canonicalCodes(offsetLengths);

  // The temp tree codes the code-length table, so it can only be built once that table
  // has been run-length encoded and its symbol frequencies are known.
  const codeTable = encodeCodeTable(codeLengths, usedCount(codeLengths));
  const tempFreqs = new Array<number>(NUM_TEMP_CODES).fill(0);
  for (const entry of codeTable) tempFreqs[entry.symbol]++;
  const tempLengths = huffmanCodeLengths(tempFreqs, MAX_CODE_LENGTH);
  const tempValues = canonicalCodes(tempLengths);

  writer.putBits(16, tokens.length);
  writeTempTable(writer, tempLengths);

  writer.putBits(9, usedCount(codeLengths));
  for (const entry of codeTable) {
    writer.putBits(tempLengths[entry.symbol], tempValues[entry.symbol]);
    if (entry.extraBits > 0) writer.putBits(entry.extraBits, entry.extraValue);
  }

  writeOffsetTable(writer, offsetLengths);

  for (const token of tokens) {
    if (token.kind === 'literal') {
      writer.putBits(codeLengths[token.byte], codeValues[token.byte]);
      continue;
    }
    const code = 256 + token.length - LH5_MIN_MATCH;
    writer.putBits(codeLengths[code], codeValues[code]);

    const offset = token.distance - 1;
    const width = offsetWidth(offset);
    writer.putBits(offsetLengths[width], offsetValues[width]);
    // The leading 1 bit is implied by the width itself, so only the remainder is sent.
    if (width >= 2) writer.putBits(width - 1, offset - (1 << (width - 1)));
  }
}

export function lh5Compress(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0) return new Uint8Array([]);

  const tokens = lzssCompress(bytes);
  const writer = new LhaBitWriter();
  for (let at = 0; at < tokens.length; at += MAX_BLOCK_COMMANDS) {
    writeBlock(writer, tokens.slice(at, at + MAX_BLOCK_COMMANDS));
  }
  return writer.toBytes();
}

export type LzToken =
  | { kind: 'literal'; byte: number }
  | { kind: 'match'; length: number; distance: number };

/**
 * `-lh5-`'s dictionary: 8 KiB, HISTORY_BITS 13 in Lhasa's lh5_decoder.c. `-lh6-` (32 KiB)
 * and `-lh7-` (64 KiB) widen it, but Amiga LhA does not read those.
 *
 * The bound comes from the format, never from how wide an offset the encoder can write.
 * This was 16384 once, reasoned backwards from the 14-bit offset code the encoder happened
 * to allow, and the archives it produced decoded perfectly under Lhasa — which tolerates a
 * distance reaching past the history it keeps. Amiga LhA 2.15 and 7-Zip both refused them:
 * 7-Zip wrote 8598 bytes of a 109956-byte file and stopped at the first over-long
 * back-reference. Nothing smaller than 8 KiB can express the fault, so every icon in the
 * archive was fine and only the bundled Installer failed.
 */
export const LH5_WINDOW = 8192;
/** Below three bytes a match costs more to encode than the literals it replaces. */
export const LH5_MIN_MATCH = 3;
/** Lengths are coded as 256 + (length - 3), and the literal/length alphabet stops at 510. */
export const LH5_MAX_MATCH = 256;

/** Chain length per hash bucket. Caps worst-case time on highly repetitive input, at a little ratio. */
const MAX_CHAIN = 128;
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;

function hash3(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 10) ^ (bytes[at + 1] << 5) ^ bytes[at + 2]) & (HASH_SIZE - 1);
}

/**
 * Greedy LZ77 match finder over a 16KB window, emitting the token stream `-lh5-` codes.
 *
 * Greedy rather than lazy-matching: lazy evaluation buys a few percent on text, and the
 * measured ratio on NewIcons `.info` data is ~69% either way because the 7-bit codec has
 * already packed the bits densely. Not worth the extra state.
 *
 * Matches may overlap the current position (distance < length); that is legal LZ77 and is
 * how a long run of one byte collapses to a single token.
 */
export function lzssCompress(bytes: Uint8Array): LzToken[] {
  const tokens: LzToken[] = [];
  if (bytes.length === 0) return tokens;

  // head[h] = most recent position with hash h; prev[p] = previous position sharing it.
  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(bytes.length).fill(-1);

  let at = 0;
  while (at < bytes.length) {
    let bestLength = 0;
    let bestDistance = 0;

    if (at + LH5_MIN_MATCH <= bytes.length) {
      const bucket = hash3(bytes, at);
      const limit = Math.max(0, at - LH5_WINDOW);
      let candidate = head[bucket];
      let chain = 0;

      while (candidate >= limit && candidate >= 0 && chain < MAX_CHAIN) {
        chain++;
        // Cheap rejection before the byte-by-byte compare.
        if (bytes[candidate + bestLength] === bytes[at + bestLength]) {
          let length = 0;
          const maxLength = Math.min(LH5_MAX_MATCH, bytes.length - at);
          while (length < maxLength && bytes[candidate + length] === bytes[at + length]) length++;
          if (length > bestLength) {
            bestLength = length;
            bestDistance = at - candidate;
            if (length === maxLength) break;
          }
        }
        candidate = prev[candidate];
      }

      prev[at] = head[bucket];
      head[bucket] = at;
    }

    if (bestLength >= LH5_MIN_MATCH) {
      tokens.push({ kind: 'match', length: bestLength, distance: bestDistance });
      // Every position inside the match still has to enter the hash chains, or later
      // matches lose the offsets that start within it.
      for (let i = 1; i < bestLength; i++) {
        const p = at + i;
        if (p + LH5_MIN_MATCH <= bytes.length) {
          const bucket = hash3(bytes, p);
          prev[p] = head[bucket];
          head[bucket] = p;
        }
      }
      at += bestLength;
    } else {
      tokens.push({ kind: 'literal', byte: bytes[at] });
      at++;
    }
  }

  return tokens;
}

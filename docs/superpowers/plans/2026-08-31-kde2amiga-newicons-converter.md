# kde2amiga NewIcons Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-based tool that converts KDE icon theme icons (SVG/PNG) into Amiga NewIcons-format `.info` files, entirely client-side, with optional MDI badge overlays and AmigaOS default-icon tagging.

**Architecture:** A Vite + React + TypeScript single-page app does all image decoding, compositing, quantization, and NewIcons binary encoding in the browser. A minimal Node/Express server serves the built SPA and proxies "fetch theme by URL" requests to work around CORS. No image processing happens server-side.

**Tech Stack:** React 18 + TypeScript + Vite (client), Vitest + Testing Library (tests), JSZip (zip read/write, client-side), Node canvas package (`canvas`) as a test-only stand-in for the DOM `<canvas>` API, Express (server, proxy + static hosting only).

**Spec:** `docs/superpowers/specs/2026-08-31-kde2amiga-design.md`

## Global Constraints

- No server-side image/icon processing — every pixel operation (decode, composite, quantize, encode) runs in browser code, testable under Node with a canvas polyfill.
- Output NewIcons `.info` files must render correctly under NewIcons-aware AmigaOS 3.2.3 / Directory Opus 5 — the binary format tasks below encode this exactly, verified against a known-working reference implementation (see Task 2 header for citation).
- v1 has no Docker packaging and no "convert entire theme" bulk default — these are out of scope per the spec's Non-goals.
- One selected-state effect applies to the whole job (no per-icon override), per spec Non-goals.
- Palette is shared/global across a job (not per-icon, not user-configurable strategy), per spec.

---

## Background: the NewIcons binary format (read before starting Tasks 2–6)

The classic Amiga `.info` file is a serialized `DiskObject` C struct. Its shape and the NewIcons tooltype-encoding scheme were verified against `steffest/Amiga-Icon-converter` (MIT-licensed, https://github.com/steffest/Amiga-Icon-converter, `icon.js`), a working JS implementation that reads and writes real `.info` files, including the bundled `test-icons/Newicons/*.info` fixtures. The layout below is transcribed and adapted from that source (fields we don't need, like `DrawerData`, are described but not implemented since we only emit non-drawer, non-`DrawerData` icons).

**DiskObject header — 78 bytes, all big-endian:**

| Field | Type | Notes |
|---|---|---|
| magic | UWORD | `0xE310` |
| version | UWORD | `1` |
| nextGadget | ULONG | `0` |
| leftEdge | UWORD | `0` |
| topEdge | UWORD | `0` |
| width | UWORD | **must equal the real icon pixel width** — this is the Workbench click/selection hotspot size, independent of the classic fallback bitmap's own size |
| height | UWORD | same caveat as width |
| flags | UWORD | `6` (matches the reference's "more current" value) |
| activation | UWORD | `3` |
| gadgetType | UWORD | `1` |
| gadgetRender | ULONG | `1` (flag: "normal image present", not a real pointer) |
| selectRender | ULONG | `1` (flag: "selected image present") |
| gadgetText | ULONG | `0` (unused) |
| mutualExclude | ULONG | `0` (unused) |
| specialInfo | ULONG | `0` (unused) |
| gadgetID | UWORD | `0` (unused) |
| userData | ULONG | `1` (marks an OS2.x/3.x-style icon) |
| type | UBYTE | 1=disk, 2=drawer, 3=tool, 4=project, 5=trashcan, 6=device, 7=kickstart, 8=appicon |
| padding | UBYTE | `0` |
| hasDefaultTool | ULONG | `0` or `1` |
| hasToolTypes | ULONG | `0` or `1` |
| currentX | LONG | `128 << 24` (magic "auto-place" value used by the reference writer) |
| currentY | LONG | `128 << 24` |
| hasDrawerData | ULONG | `0` (we never emit `DrawerData`) |
| hasToolWindow | ULONG | `0` |
| stackSize | ULONG | `8192` |

**Classic (fallback) Image struct — 20-byte header + planar bitmap data, written twice (normal, then selected):**

| Field | Type |
|---|---|
| leftEdge | UWORD |
| topEdge | UWORD |
| width | UWORD |
| height | UWORD |
| depth | UWORD |
| hasImageData | ULONG |
| planePick | UBYTE |
| planeOnOff | UBYTE |
| nextImage | ULONG |

Followed by `depth` bitplanes, each `height` rows of `((width + 15) >> 4) << 1` bytes (row width rounded up to a 16-pixel/2-byte boundary), MSB-first. We always emit `depth = 1` (a 2-color classic fallback — real rendering happens via the NewIcons tooltype data on NewIcons-aware software; non-aware software just sees a plain 2-color icon). **`width`/`height` here must match the DiskObject header's width/height**, per the hotspot-size caveat above.

**Text fields** (`defaultTool`, each tooltype string): `ULONG` length (string length + 1, for the trailing NUL), then the string bytes, then one `0x00` byte. We never emit a `defaultTool` for icons (`hasDefaultTool = 0`).

**ToolTypes array** (only emitted when `hasToolTypes = 1`): `ULONG` count-field equal to `(numToolTypes + 1) * 4` (an Amiga convention — one dummy trailing "slot" for the null pointer that terminates the real in-memory array), followed by each tooltype string in the text-field format above, in order.

**NewIcons tooltype lines** — this is where the actual full-color image lives. Two tooltypes carry it: all lines starting `IM1=` concatenate to form the "normal" state; all lines starting `IM2=` concatenate to form the "selected" state. Each tooltype string is at most 127 bytes **including** the 4-byte `IM1=`/`IM2=` prefix, so at most 123 bytes of payload per line.

The payload is a stream of 7-bit values, each packed into one output byte:

```
value 0–79   -> byte = value + 32   (byte range 0x20–0x6F)
value 80–127 -> byte = value + 81   (byte range 0xA1–0xD0)
```

(Bytes `0xD1`–`0xFF` are a run-length code for repeated all-zero 7-bit groups in the reference decoder. We deliberately do **not** emit RLE in our encoder — see Task 3 for why — but our decoder used in tests must still understand plain literal bytes, which is all we produce.)

The **first** `IM1=`/`IM2=` line's payload starts with a 5-character header, then the palette, all as one continuous 7-bit-packed stream:

| Header char | Meaning |
|---|---|
| 0 | `'B'` (66) if this state has a transparent color (index 0 is transparent), any other byte otherwise |
| 1 | `width + 33` |
| 2 | `height + 33` |
| 3 | `(colorCount >> 6) + 33` |
| 4 | `(colorCount & 0x3F) + 33` |

Immediately after the header, still 7-bit-packed into the same line, comes the palette: `colorCount` entries of R, G, B (8 bits each, 24 bits/color, MSB-first). **The entire header + palette must fit in the first line's 123-byte payload** (the reference decoder only ever reads palette data from the first line) — 123 bytes = 861 bits, minus the 35-bit header (5 chars × 7 bits) leaves 826 bits for the palette, i.e. `floor(826 / 24) = 34` colors absolute max with our no-RLE encoder. Task 7 turns this into a concrete, conservative default cap.

All **subsequent** `IM1=`/`IM2=` lines (and the remainder of pixel data, which never shares a line with the palette) carry pixel indices, `bitCount = ceil(log2(colorCount))` bits each, `width * height` of them, in row-major order, 7-bit-packed the same way, spanning as many additional lines as needed.

---

### Task 1: Project scaffold

**Files:**
- Create: `client/package.json`, `client/vite.config.ts`, `client/vitest.config.ts`, `client/tsconfig.json`, `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx`
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/index.ts`
- Create: `package.json` (root, orchestration only)
- Create: `.gitignore`

**Interfaces:**
- Produces: a working `npm run dev` at the repo root that starts both the client dev server and the Express server; a working `npm test` in `client/` that runs Vitest.

- [ ] **Step 1: Scaffold the Vite React-TS client**

```bash
mkdir -p client server
cd client
npm create vite@latest . -- --template react-ts
```

- [ ] **Step 2: Add test tooling to the client**

```bash
cd client
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom canvas jszip
```

Create `client/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

Create `client/src/test/setup.ts`:

```typescript
import '@testing-library/jest-dom/vitest';
```

Add to `client/package.json` `scripts`: `"test": "vitest run"`.

- [ ] **Step 3: Verify the client test runner works**

Create `client/src/test/smoke.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `cd client && npm test`
Expected: PASS (1 test)

- [ ] **Step 4: Scaffold the Express server**

```bash
cd server
npm init -y
npm install express
npm install --save-dev typescript @types/express @types/node tsx
```

Create `server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

Create `server/src/index.ts`:

```typescript
import express from 'express';
import path from 'node:path';

const app = express();
const PORT = process.env.PORT ?? 3001;
const CLIENT_DIST = path.resolve(import.meta.dirname, '../../client/dist');

app.use(express.static(CLIENT_DIST));

app.listen(PORT, () => {
  console.log(`kde2amiga server listening on http://localhost:${PORT}`);
});
```

Add to `server/package.json` `scripts`: `"dev": "tsx watch src/index.ts"`, `"build": "tsc"`, `"start": "node dist/index.js"`. Set `"type": "module"`.

- [ ] **Step 5: Wire up root orchestration**

Create root `package.json`:

```json
{
  "name": "kde2amiga",
  "private": true,
  "scripts": {
    "dev": "npm --prefix server run dev & npm --prefix client run dev",
    "test": "npm --prefix client test"
  },
  "devDependencies": {}
}
```

Create root `.gitignore`:

```
node_modules/
dist/
*.local
```

- [ ] **Step 6: Commit**

```bash
git add client server package.json .gitignore
git commit -m "Scaffold client (Vite+React+TS+Vitest) and server (Express) projects"
```

---

### Task 2: BinaryWriter utility

**Files:**
- Create: `client/src/lib/newicons/binaryWriter.ts`
- Test: `client/src/lib/newicons/binaryWriter.test.ts`

**Interfaces:**
- Produces: `class BinaryWriter` with `writeUByte(n)`, `writeWord(n)`, `writeDWord(n)`, `writeLong(n)` (signed dword, same bit layout), `writeString(s)` (raw ASCII bytes, no length prefix, no terminator), `writeBytes(bytes: Uint8Array)`, and `toUint8Array(): Uint8Array`. All multi-byte writes are big-endian (Amiga native byte order).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { BinaryWriter } from './binaryWriter';

describe('BinaryWriter', () => {
  it('writes big-endian words and dwords', () => {
    const w = new BinaryWriter();
    w.writeUByte(0xe3);
    w.writeUByte(0x10);
    w.writeWord(0x0001);
    w.writeDWord(0x00000080);
    const bytes = w.toUint8Array();
    expect(Array.from(bytes)).toEqual([0xe3, 0x10, 0x00, 0x01, 0x00, 0x00, 0x00, 0x80]);
  });

  it('writes raw ASCII strings without a terminator', () => {
    const w = new BinaryWriter();
    w.writeString('IM1=');
    expect(Array.from(w.toUint8Array())).toEqual([0x49, 0x4d, 0x31, 0x3d]);
  });

  it('writes signed longs using two-s-complement big-endian bytes', () => {
    const w = new BinaryWriter();
    w.writeLong(-1);
    expect(Array.from(w.toUint8Array())).toEqual([0xff, 0xff, 0xff, 0xff]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/newicons/binaryWriter.test.ts`
Expected: FAIL — `binaryWriter` module not found

- [ ] **Step 3: Write the implementation**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/newicons/binaryWriter.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/newicons/binaryWriter.ts client/src/lib/newicons/binaryWriter.test.ts
git commit -m "Add BinaryWriter for big-endian .info file assembly"
```

---

### Task 3: NewIcons 7-bit codec (bit packing + literal byte encoding)

**Files:**
- Create: `client/src/lib/newicons/sevenBitCodec.ts`
- Test: `client/src/lib/newicons/sevenBitCodec.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `class BitWriter` with `pushBits(value: number, width: number): void` and `toSevenBitGroups(): number[]` (each element 0–127, zero-padded on the final group); `encodeSevenBitGroups(groups: number[]): string` (maps each 0–127 group to its literal output byte per the format rules, returns a JS string of those char codes); `decodeSevenBitGroupsForTest(encoded: string): number[]` (the literal-only inverse, used only by our own round-trip tests — production code never needs to decode, but the test suite needs to verify against something, and this doubles as executable documentation of the reference decoder's `decodeBits` semantics we're targeting).

We deliberately skip RLE on the encode side: our worst-case palette (Task 7 caps colors so header+palette always fits one line) and per-icon pixel data are small enough that literal-only encoding is simple, always correct, and easy to verify byte-for-byte — RLE is a decode-side capability we rely on real NewIcons-aware software *not* requiring, since literal encoding is valid input to it. Adding RLE would only reduce output size, which isn't a v1 requirement.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { BitWriter, encodeSevenBitGroups, decodeSevenBitGroupsForTest } from './sevenBitCodec';

describe('BitWriter', () => {
  it('packs pushed bits into 7-bit groups, zero-padding the last group', () => {
    const w = new BitWriter();
    w.pushBits(0b1010, 4); // 4 bits: 1010
    w.pushBits(0b110, 3); // 3 bits: 110  -> combined 7 bits: 1010110
    const groups = w.toSevenBitGroups();
    expect(groups).toEqual([0b1010110]);
  });

  it('splits more than 7 bits across multiple groups with right-padding on the last', () => {
    const w = new BitWriter();
    w.pushBits(0b111111111, 9); // 9 bits: 111111111
    // group 1 = first 7 bits = 1111111, group 2 = remaining 2 bits '11' padded to '1100000'
    const groups = w.toSevenBitGroups();
    expect(groups).toEqual([0b1111111, 0b1100000]);
  });
});

describe('encodeSevenBitGroups / decodeSevenBitGroupsForTest round-trip', () => {
  it('encodes values 0-79 into the 0x20-0x6F range', () => {
    const encoded = encodeSevenBitGroups([0, 40, 79]);
    expect(encoded.charCodeAt(0)).toBe(32);
    expect(encoded.charCodeAt(1)).toBe(72);
    expect(encoded.charCodeAt(2)).toBe(111);
  });

  it('encodes values 80-127 into the 0xA1-0xD0 range', () => {
    const encoded = encodeSevenBitGroups([80, 127]);
    expect(encoded.charCodeAt(0)).toBe(161);
    expect(encoded.charCodeAt(1)).toBe(208);
  });

  it('round-trips arbitrary 7-bit group sequences', () => {
    const groups = [0, 1, 79, 80, 100, 127, 50];
    const encoded = encodeSevenBitGroups(groups);
    expect(decodeSevenBitGroupsForTest(encoded)).toEqual(groups);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/newicons/sevenBitCodec.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/newicons/sevenBitCodec.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/newicons/sevenBitCodec.ts client/src/lib/newicons/sevenBitCodec.test.ts
git commit -m "Add NewIcons 7-bit literal packing codec"
```

---

### Task 4: Palette-fit cap

**Files:**
- Create: `client/src/lib/newicons/paletteLimits.ts`
- Test: `client/src/lib/newicons/paletteLimits.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `const MAX_LINE_PAYLOAD_BYTES = 123`, `const HEADER_CHARS = 5`, `function maxColorsForSingleLine(): number`, `function bitCountForColors(colorCount: number): number`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { maxColorsForSingleLine, bitCountForColors } from './paletteLimits';

describe('maxColorsForSingleLine', () => {
  it('computes the largest palette that fits header+palette in one 123-byte line', () => {
    // (123 - 5) chars * 7 bits = 826 bits available for palette; 826 / 24 = 34.41
    expect(maxColorsForSingleLine()).toBe(34);
  });
});

describe('bitCountForColors', () => {
  it('returns the minimum bits needed to index colorCount colors', () => {
    expect(bitCountForColors(2)).toBe(1);
    expect(bitCountForColors(3)).toBe(2);
    expect(bitCountForColors(16)).toBe(4);
    expect(bitCountForColors(17)).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/newicons/paletteLimits.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
export const MAX_LINE_PAYLOAD_BYTES = 123; // 127 - 4 for "IM1="/"IM2="
export const HEADER_CHARS = 5;
const BITS_PER_CHAR = 7;
const BITS_PER_PALETTE_ENTRY = 24; // 8 bits each of R, G, B

export function maxColorsForSingleLine(): number {
  const availableBits = (MAX_LINE_PAYLOAD_BYTES - HEADER_CHARS) * BITS_PER_CHAR;
  return Math.floor(availableBits / BITS_PER_PALETTE_ENTRY);
}

export function bitCountForColors(colorCount: number): number {
  let bits = 1;
  while (1 << bits < colorCount) bits++;
  return bits;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/newicons/paletteLimits.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/newicons/paletteLimits.ts client/src/lib/newicons/paletteLimits.test.ts
git commit -m "Add NewIcons single-line palette size limit calculation"
```

---

### Task 5: NewIcons tooltype line builder

**Files:**
- Create: `client/src/lib/newicons/newIconsEncoder.ts`
- Test: `client/src/lib/newicons/newIconsEncoder.test.ts`

**Interfaces:**
- Consumes: `BitWriter`, `encodeSevenBitGroups` from `./sevenBitCodec`; `bitCountForColors`, `MAX_LINE_PAYLOAD_BYTES` from `./paletteLimits`.
- Produces: `interface NewIconState { width: number; height: number; transparent: boolean; palette: [number, number, number][]; pixels: number[] }` (pixels are palette indices, row-major, length `width*height`); `function encodeNewIconState(state: NewIconState, prefix: 'IM1=' | 'IM2='): string[]` (returns the list of tooltype strings, each ≤127 chars, ready to insert into the ToolTypes array).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { encodeNewIconState } from './newIconsEncoder';

describe('encodeNewIconState', () => {
  it('produces IM1= lines each no longer than 127 characters', () => {
    const width = 8;
    const height = 8;
    const palette: [number, number, number][] = [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [0, 255, 0],
    ];
    const pixels = new Array(width * height).fill(0).map((_, i) => i % palette.length);
    const lines = encodeNewIconState({ width, height, transparent: true, palette, pixels }, 'IM1=');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(127);
      expect(line.startsWith('IM1=')).toBe(true);
    }
  });

  it('encodes the header so width/height/colorCount/transparency round-trip', () => {
    const palette: [number, number, number][] = [
      [10, 20, 30],
      [200, 210, 220],
    ];
    const pixels = [0, 1, 1, 0];
    const lines = encodeNewIconState(
      { width: 2, height: 2, transparent: true, palette, pixels },
      'IM1=',
    );
    const headerPayload = lines[0].slice(4); // strip "IM1="
    expect(headerPayload.charCodeAt(0)).toBe(66); // 'B' -> transparent
    expect(headerPayload.charCodeAt(1) - 33).toBe(2); // width
    expect(headerPayload.charCodeAt(2) - 33).toBe(2); // height
    const colorCount = ((headerPayload.charCodeAt(3) - 33) << 6) + (headerPayload.charCodeAt(4) - 33);
    expect(colorCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/newicons/newIconsEncoder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
import { BitWriter, encodeSevenBitGroups } from './sevenBitCodec';
import { bitCountForColors, MAX_LINE_PAYLOAD_BYTES } from './paletteLimits';

export interface NewIconState {
  width: number;
  height: number;
  transparent: boolean;
  palette: [number, number, number][];
  pixels: number[]; // palette indices, row-major, length width*height
}

function chunkString(s: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < s.length; i += size) chunks.push(s.slice(i, i + size));
  return chunks;
}

export function encodeNewIconState(state: NewIconState, prefix: 'IM1=' | 'IM2='): string[] {
  const { width, height, transparent, palette, pixels } = state;
  const colorCount = palette.length;

  // --- Line 1 payload: header + full palette ---
  const headerAndPalette = new BitWriter();
  headerAndPalette.pushBits(transparent ? 66 : 78, 7); // 'B' or 'N', both < 128
  headerAndPalette.pushBits(width + 33, 7);
  headerAndPalette.pushBits(height + 33, 7);
  headerAndPalette.pushBits(((colorCount >> 6) & 0x3f) + 33, 7);
  headerAndPalette.pushBits((colorCount & 0x3f) + 33, 7);
  for (const [r, g, b] of palette) {
    headerAndPalette.pushBits(r, 8);
    headerAndPalette.pushBits(g, 8);
    headerAndPalette.pushBits(b, 8);
  }
  const firstLinePayload = encodeSevenBitGroups(headerAndPalette.toSevenBitGroups());

  // --- Remaining lines: pixel indices ---
  const bitCount = bitCountForColors(colorCount);
  const pixelBits = new BitWriter();
  for (const index of pixels) pixelBits.pushBits(index, bitCount);
  const pixelPayload = encodeSevenBitGroups(pixelBits.toSevenBitGroups());

  const lines = [prefix + firstLinePayload];
  for (const chunk of chunkString(pixelPayload, MAX_LINE_PAYLOAD_BYTES)) {
    lines.push(prefix + chunk);
  }
  return lines;
}
```

Note: the header's non-transparent sentinel is `78` (`'N'`), matching the reference decoder's rule (only byte `66`/`'B'` means "transparent"); any other byte is fine.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/newicons/newIconsEncoder.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/newicons/newIconsEncoder.ts client/src/lib/newicons/newIconsEncoder.test.ts
git commit -m "Add NewIcons IM1=/IM2= tooltype line encoder"
```

---

### Task 6: Classic fallback bitplane image

**Files:**
- Create: `client/src/lib/newicons/classicImage.ts`
- Test: `client/src/lib/newicons/classicImage.test.ts`

**Interfaces:**
- Consumes: `BinaryWriter` from `./binaryWriter`.
- Produces: `function packClassicImageBitplane(width: number, height: number, selected: boolean): Uint8Array` (a single 1-bit bitplane, row width rounded up to the next 16-pixel boundary, MSB-first: a simple filled-border-square pattern, inverted when `selected` is true — this is only ever seen by non-NewIcons-aware software).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { packClassicImageBitplane } from './classicImage';

describe('packClassicImageBitplane', () => {
  it('produces rows padded to a 16-pixel (2-byte) boundary', () => {
    const bytes = packClassicImageBitplane(8, 4, false);
    // width 8 -> rounded up to 16 -> 2 bytes/row; height 4 -> 8 bytes total
    expect(bytes.length).toBe(8);
  });

  it('draws a filled border: top row is all 1 bits within the width', () => {
    const bytes = packClassicImageBitplane(8, 4, false);
    // first row, first byte: top-left 8 pixels should all be set (border)
    expect(bytes[0]).toBe(0b11111111);
  });

  it('inverts the pattern when selected is true', () => {
    const normal = packClassicImageBitplane(8, 4, false);
    const selected = packClassicImageBitplane(8, 4, true);
    expect(selected[0]).toBe((~normal[0]) & 0xff);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/newicons/classicImage.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/newicons/classicImage.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/newicons/classicImage.ts client/src/lib/newicons/classicImage.test.ts
git commit -m "Add classic 1-bit fallback icon bitplane generator"
```

---

### Task 7: DiskObject assembler (full `.info` file writer)

**Files:**
- Create: `client/src/lib/newicons/diskObject.ts`
- Create: `client/src/lib/newicons/diskObjectDecoderForTest.ts`
- Test: `client/src/lib/newicons/diskObject.test.ts`

**Interfaces:**
- Consumes: `BinaryWriter`, `packClassicImageBitplane`, `encodeNewIconState`, `NewIconState`.
- Produces: `type IconKind = 'disk' | 'drawer' | 'tool' | 'project' | 'trashcan'`; `function buildInfoFile(params: { width: number; height: number; kind: IconKind; normal: NewIconState; selected: NewIconState }): Uint8Array` — the complete bytes of a `.info` file.
- Also produces (test-only, in `diskObjectDecoderForTest.ts`): `function decodeInfoFileForTest(bytes: Uint8Array): { magic: number; type: number; width: number; height: number; normal: NewIconState; selected: NewIconState }` — a minimal reader, ported from the same reference implementation, used only to verify our writer round-trips correctly. This is not shipped in the conversion pipeline (we only ever write `.info` files, never read them back), but it is the cheapest way to get confidence the encoder is correct without real Amiga hardware.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { buildInfoFile } from './diskObject';
import { decodeInfoFileForTest } from './diskObjectDecoderForTest';
import type { NewIconState } from './newIconsEncoder';

function makeState(width: number, height: number): NewIconState {
  const palette: [number, number, number][] = [
    [0, 0, 0],
    [255, 255, 255],
    [200, 40, 40],
  ];
  const pixels = new Array(width * height).fill(0).map((_, i) => i % palette.length);
  return { width, height, transparent: true, palette, pixels };
}

describe('buildInfoFile', () => {
  it('starts with the 0xE310 magic number', () => {
    const bytes = buildInfoFile({
      width: 4,
      height: 4,
      kind: 'project',
      normal: makeState(4, 4),
      selected: makeState(4, 4),
    });
    expect(bytes[0]).toBe(0xe3);
    expect(bytes[1]).toBe(0x10);
  });

  it('round-trips icon type, dimensions, and both NewIcons image states', () => {
    const normal = makeState(4, 4);
    const selected = makeState(4, 4);
    const bytes = buildInfoFile({ width: 4, height: 4, kind: 'drawer', normal, selected });
    const decoded = decodeInfoFileForTest(bytes);

    expect(decoded.type).toBe(2); // drawer
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
    expect(decoded.normal.palette).toEqual(normal.palette);
    expect(decoded.normal.pixels).toEqual(normal.pixels);
    expect(decoded.selected.pixels).toEqual(selected.pixels);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/newicons/diskObject.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Write the test-only decoder**

```typescript
// client/src/lib/newicons/diskObjectDecoderForTest.ts
import type { NewIconState } from './newIconsEncoder';

class Reader {
  private pos = 0;
  constructor(private bytes: Uint8Array) {}
  ubyte(): number { return this.bytes[this.pos++]; }
  word(): number { const v = (this.bytes[this.pos] << 8) | this.bytes[this.pos + 1]; this.pos += 2; return v; }
  dword(): number {
    const v = (this.bytes[this.pos] * 2 ** 24) + (this.bytes[this.pos + 1] << 16) + (this.bytes[this.pos + 2] << 8) + this.bytes[this.pos + 3];
    this.pos += 4;
    return v >>> 0;
  }
  skip(n: number): void { this.pos += n; }
  get index(): number { return this.pos; }
  set index(v: number) { this.pos = v; }
}

function decodeSevenBitLiteral(encoded: string): number[] {
  const groups: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    const byte = encoded.charCodeAt(i);
    groups.push(byte < 160 ? byte - 32 : byte - 81);
  }
  return groups;
}

function groupsToBitString(groups: number[]): string {
  return groups.map((g) => g.toString(2).padStart(7, '0')).join('');
}

function decodeNewIconLines(lines: string[]): NewIconState {
  const firstPayload = lines[0];
  const firstBits = groupsToBitString(decodeSevenBitLiteral(firstPayload));
  const transparent = decodeSevenBitLiteral(firstPayload.slice(0, 1))[0] === 66;
  const width = decodeSevenBitLiteral(firstPayload.slice(1, 2))[0] - 33;
  const height = decodeSevenBitLiteral(firstPayload.slice(2, 3))[0] - 33;
  const hi = decodeSevenBitLiteral(firstPayload.slice(3, 4))[0] - 33;
  const lo = decodeSevenBitLiteral(firstPayload.slice(4, 5))[0] - 33;
  const colorCount = (hi << 6) + lo;

  // header is 5 chars * 7 bits = 35 bits into firstBits; palette follows
  const paletteBits = firstBits.slice(35, 35 + colorCount * 24);
  const palette: [number, number, number][] = [];
  for (let i = 0; i < colorCount; i++) {
    const base = i * 24;
    const r = parseInt(paletteBits.slice(base, base + 8), 2);
    const g = parseInt(paletteBits.slice(base + 8, base + 16), 2);
    const b = parseInt(paletteBits.slice(base + 16, base + 24), 2);
    palette.push([r, g, b]);
  }

  let bitCount = 1;
  while (1 << bitCount < colorCount) bitCount++;

  const pixelPayload = lines.slice(1).join('');
  const pixelBits = groupsToBitString(decodeSevenBitLiteral(pixelPayload));
  const pixelCount = width * height;
  const pixels: number[] = [];
  for (let i = 0; i < pixelCount; i++) {
    pixels.push(parseInt(pixelBits.slice(i * bitCount, i * bitCount + bitCount), 2));
  }

  return { width, height, transparent, palette, pixels };
}

export function decodeInfoFileForTest(bytes: Uint8Array) {
  const r = new Reader(bytes);
  const magic = r.word();
  r.word(); // version
  r.dword(); // nextGadget
  r.word(); // leftEdge
  r.word(); // topEdge
  const width = r.word();
  const height = r.word();
  r.word(); // flags
  r.word(); // activation
  r.word(); // gadgetType
  r.dword(); // gadgetRender
  r.dword(); // selectRender
  r.dword(); // gadgetText
  r.dword(); // mutualExclude
  r.dword(); // specialInfo
  r.word(); // gadgetID
  r.dword(); // userData
  const type = r.ubyte();
  r.ubyte(); // padding
  r.dword(); // hasDefaultTool
  const hasToolTypes = r.dword();
  r.dword(); // currentX
  r.dword(); // currentY
  r.dword(); // hasDrawerData
  r.dword(); // hasToolWindow
  r.dword(); // stackSize

  // two classic images
  for (let i = 0; i < 2; i++) {
    r.word(); r.word(); // leftEdge, topEdge
    const imgWidth = r.word();
    const imgHeight = r.word();
    const depth = r.word();
    r.dword(); // hasImageData
    r.ubyte(); r.ubyte(); // planePick, planeOnOff
    r.dword(); // nextImage
    const rowBytes = ((imgWidth + 15) >> 4) << 1;
    r.skip(rowBytes * imgHeight * depth);
  }

  const toolTypes: string[] = [];
  if (hasToolTypes) {
    const countField = r.dword();
    const count = countField ? countField / 4 - 1 : 0;
    for (let i = 0; i < count; i++) {
      const len = r.dword();
      let s = '';
      for (let j = 0; j < len - 1; j++) s += String.fromCharCode(r.ubyte());
      r.ubyte(); // NUL
      toolTypes.push(s);
    }
  }

  const im1Lines = toolTypes.filter((t) => t.startsWith('IM1=')).map((t) => t.slice(4));
  const im2Lines = toolTypes.filter((t) => t.startsWith('IM2=')).map((t) => t.slice(4));

  return {
    magic,
    type,
    width,
    height,
    normal: decodeNewIconLines(im1Lines),
    selected: decodeNewIconLines(im2Lines),
  };
}
```

- [ ] **Step 4: Write the writer implementation**

```typescript
// client/src/lib/newicons/diskObject.ts
import { BinaryWriter } from './binaryWriter';
import { packClassicImageBitplane } from './classicImage';
import { encodeNewIconState, type NewIconState } from './newIconsEncoder';

export type IconKind = 'disk' | 'drawer' | 'tool' | 'project' | 'trashcan';

const ICON_TYPE_CODES: Record<IconKind, number> = {
  disk: 1,
  drawer: 2,
  tool: 3,
  project: 4,
  trashcan: 5,
};

export function buildInfoFile(params: {
  width: number;
  height: number;
  kind: IconKind;
  normal: NewIconState;
  selected: NewIconState;
}): Uint8Array {
  const { width, height, kind, normal, selected } = params;

  const toolTypes = [
    ...encodeNewIconState(normal, 'IM1='),
    ...encodeNewIconState(selected, 'IM2='),
  ];

  const w = new BinaryWriter();

  // DiskObject header (78 bytes)
  w.writeWord(0xe310);
  w.writeWord(1); // version
  w.writeDWord(0); // nextGadget
  w.writeWord(0); // leftEdge
  w.writeWord(0); // topEdge
  w.writeWord(width);
  w.writeWord(height);
  w.writeWord(6); // flags
  w.writeWord(3); // activation
  w.writeWord(1); // gadgetType
  w.writeDWord(1); // gadgetRender
  w.writeDWord(1); // selectRender
  w.writeDWord(0); // gadgetText
  w.writeDWord(0); // mutualExclude
  w.writeDWord(0); // specialInfo
  w.writeWord(0); // gadgetID
  w.writeDWord(1); // userData
  w.writeUByte(ICON_TYPE_CODES[kind]);
  w.writeUByte(0); // padding
  w.writeDWord(0); // hasDefaultTool
  w.writeDWord(1); // hasToolTypes
  w.writeLong(128 << 24); // currentX
  w.writeLong(128 << 24); // currentY
  w.writeDWord(0); // hasDrawerData
  w.writeDWord(0); // hasToolWindow
  w.writeDWord(8192); // stackSize

  writeClassicImage(w, width, height, false);
  writeClassicImage(w, width, height, true);

  // ToolTypes array
  w.writeDWord((toolTypes.length + 1) * 4);
  for (const toolType of toolTypes) {
    w.writeDWord(toolType.length + 1);
    w.writeString(toolType);
    w.writeUByte(0);
  }

  return w.toUint8Array();
}

function writeClassicImage(w: BinaryWriter, width: number, height: number, selected: boolean): void {
  w.writeWord(0); // leftEdge
  w.writeWord(0); // topEdge
  w.writeWord(width);
  w.writeWord(height);
  w.writeWord(1); // depth
  w.writeDWord(1); // hasImageData
  w.writeUByte(0); // planePick
  w.writeUByte(0); // planeOnOff
  w.writeDWord(0); // nextImage
  w.writeBytes(packClassicImageBitplane(width, height, selected));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/newicons/diskObject.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/newicons/diskObject.ts client/src/lib/newicons/diskObjectDecoderForTest.ts client/src/lib/newicons/diskObject.test.ts
git commit -m "Add DiskObject .info file assembler with round-trip test decoder"
```

---

### Task 8: Median-cut quantizer

**Files:**
- Create: `client/src/lib/image/quantize.ts`
- Test: `client/src/lib/image/quantize.test.ts`

**Interfaces:**
- Consumes: `maxColorsForSingleLine` from `../newicons/paletteLimits` (as the hard ceiling).
- Produces: `interface RgbaImage { width: number; height: number; data: Uint8ClampedArray }` (RGBA, 4 bytes/pixel, matches `ImageData.data`); `function buildSharedPalette(images: RgbaImage[], maxColors: number): [number, number, number][]` (median-cut over every opaque pixel across all images, capped at `Math.min(maxColors, maxColorsForSingleLine())`, always includes `[0, 0, 0]` at index 0 to serve as the transparent/background color); `function mapImageToPalette(image: RgbaImage, palette: [number, number, number][]): number[]` (nearest-color palette indices, row-major; fully-transparent source pixels map to index `0`).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { buildSharedPalette, mapImageToPalette, type RgbaImage } from './quantize';

function solidImage(width: number, height: number, rgba: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
}

describe('buildSharedPalette', () => {
  it('always reserves index 0 for transparent/background black', () => {
    const palette = buildSharedPalette([solidImage(2, 2, [255, 0, 0, 255])], 8);
    expect(palette[0]).toEqual([0, 0, 0]);
  });

  it('never exceeds maxColors', () => {
    const images = [
      solidImage(2, 2, [255, 0, 0, 255]),
      solidImage(2, 2, [0, 255, 0, 255]),
      solidImage(2, 2, [0, 0, 255, 255]),
    ];
    const palette = buildSharedPalette(images, 2);
    expect(palette.length).toBeLessThanOrEqual(2);
  });
});

describe('mapImageToPalette', () => {
  it('maps fully transparent pixels to index 0', () => {
    const image = solidImage(1, 1, [10, 20, 30, 0]);
    const palette: [number, number, number][] = [[0, 0, 0], [10, 20, 30]];
    expect(mapImageToPalette(image, palette)).toEqual([0]);
  });

  it('maps opaque pixels to their nearest palette color', () => {
    const image = solidImage(1, 1, [12, 18, 29, 255]);
    const palette: [number, number, number][] = [[0, 0, 0], [10, 20, 30], [200, 200, 200]];
    expect(mapImageToPalette(image, palette)).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/image/quantize.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
import { maxColorsForSingleLine } from '../newicons/paletteLimits';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

type Rgb = [number, number, number];

function collectOpaquePixels(images: RgbaImage[]): Rgb[] {
  const pixels: Rgb[] = [];
  for (const image of images) {
    for (let i = 0; i < image.data.length; i += 4) {
      if (image.data[i + 3] > 0) {
        pixels.push([image.data[i], image.data[i + 1], image.data[i + 2]]);
      }
    }
  }
  return pixels;
}

function widestChannel(pixels: Rgb[]): 0 | 1 | 2 {
  const min: Rgb = [255, 255, 255];
  const max: Rgb = [0, 0, 0];
  for (const [r, g, b] of pixels) {
    min[0] = Math.min(min[0], r); max[0] = Math.max(max[0], r);
    min[1] = Math.min(min[1], g); max[1] = Math.max(max[1], g);
    min[2] = Math.min(min[2], b); max[2] = Math.max(max[2], b);
  }
  const ranges = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const widest = ranges.indexOf(Math.max(...ranges));
  return widest as 0 | 1 | 2;
}

function medianCut(pixels: Rgb[], targetCount: number): Rgb[][] {
  const buckets: Rgb[][] = [pixels];
  while (buckets.length < targetCount) {
    let splitIndex = -1;
    let splitSize = 0;
    buckets.forEach((bucket, i) => {
      if (bucket.length > splitSize && bucket.length > 1) {
        splitSize = bucket.length;
        splitIndex = i;
      }
    });
    if (splitIndex === -1) break; // nothing left worth splitting

    const bucket = buckets[splitIndex];
    const channel = widestChannel(bucket);
    bucket.sort((a, b) => a[channel] - b[channel]);
    const mid = Math.floor(bucket.length / 2);
    buckets.splice(splitIndex, 1, bucket.slice(0, mid), bucket.slice(mid));
  }
  return buckets;
}

function average(bucket: Rgb[]): Rgb {
  const sum = bucket.reduce((acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b], [0, 0, 0]);
  return [
    Math.round(sum[0] / bucket.length),
    Math.round(sum[1] / bucket.length),
    Math.round(sum[2] / bucket.length),
  ];
}

export function buildSharedPalette(images: RgbaImage[], maxColors: number): Rgb[] {
  const cap = Math.min(maxColors, maxColorsForSingleLine());
  const pixels = collectOpaquePixels(images);
  const palette: Rgb[] = [[0, 0, 0]]; // reserved transparent/background slot

  if (pixels.length === 0) return palette;

  const remainingSlots = Math.max(cap - 1, 0);
  if (remainingSlots === 0) return palette;

  const buckets = medianCut(pixels, remainingSlots).filter((b) => b.length > 0);
  for (const bucket of buckets) palette.push(average(bucket));
  return palette.slice(0, cap);
}

function colorDistance(a: Rgb, b: Rgb): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

export function mapImageToPalette(image: RgbaImage, palette: Rgb[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] === 0) {
      indices.push(0);
      continue;
    }
    const pixel: Rgb = [image.data[i], image.data[i + 1], image.data[i + 2]];
    let bestIndex = 0;
    let bestDistance = Infinity;
    palette.forEach((color, index) => {
      const distance = colorDistance(pixel, color);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    indices.push(bestIndex);
  }
  return indices;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/image/quantize.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/image/quantize.ts client/src/lib/image/quantize.test.ts
git commit -m "Add median-cut shared palette builder and nearest-color mapper"
```

---

### Task 9: Selected-state effect generator

**Files:**
- Create: `client/src/lib/image/selectedState.ts`
- Test: `client/src/lib/image/selectedState.test.ts`

**Interfaces:**
- Consumes: nothing beyond plain arrays/tuples (works on an already-quantized palette + index buffer, per spec).
- Produces: `type SelectedStateEffect = 'invert' | 'brighten' | 'darken' | 'tint' | 'glowSurround'`; `function applySelectedStateEffect(effect: SelectedStateEffect, palette: [number, number, number][], pixels: number[], width: number, height: number, tintColor?: [number, number, number]): number[]` — returns a new palette-index array (same length as `pixels`) built by remapping each used palette color through the effect and nearest-matching it back onto the *same* palette (so both states keep sharing one palette, per spec), except `glowSurround`, which additionally sets a 1px border of background-adjacent transparent pixels to the brightest palette color to simulate a glow.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { applySelectedStateEffect } from './selectedState';

const palette: [number, number, number][] = [
  [0, 0, 0],
  [255, 255, 255],
  [100, 100, 100],
];

describe('applySelectedStateEffect', () => {
  it('invert maps each color to its nearest match after RGB inversion', () => {
    // pixel using palette[1] = white (255,255,255) inverted -> black (0,0,0) -> nearest is palette[0]
    const result = applySelectedStateEffect('invert', palette, [1], 1, 1);
    expect(result).toEqual([0]);
  });

  it('brighten pushes colors toward white and re-snaps to the palette', () => {
    // mid-gray brightened should land closer to white than to black
    const result = applySelectedStateEffect('brighten', palette, [2], 1, 1);
    expect(result).toEqual([1]);
  });

  it('darken pushes colors toward black and re-snaps to the palette', () => {
    const result = applySelectedStateEffect('darken', palette, [2], 1, 1);
    expect(result).toEqual([0]);
  });

  it('tint blends toward the given tint color', () => {
    const result = applySelectedStateEffect('tint', palette, [1], 1, 1, [0, 0, 0]);
    // white tinted toward black should move away from index 1 (pure white)
    expect(result[0]).not.toBe(1);
  });

  it('glowSurround leaves interior pixels alone but does not throw on a 1x1 image', () => {
    const result = applySelectedStateEffect('glowSurround', palette, [1], 1, 1);
    expect(result.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/image/selectedState.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
export type SelectedStateEffect = 'invert' | 'brighten' | 'darken' | 'tint' | 'glowSurround';

type Rgb = [number, number, number];

function clamp(n: number): number {
  return Math.max(0, Math.min(255, n));
}

function nearestPaletteIndex(color: Rgb, palette: Rgb[]): number {
  let bestIndex = 0;
  let bestDistance = Infinity;
  palette.forEach((candidate, index) => {
    const distance =
      (candidate[0] - color[0]) ** 2 + (candidate[1] - color[1]) ** 2 + (candidate[2] - color[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function transformColor(effect: SelectedStateEffect, [r, g, b]: Rgb, tintColor?: Rgb): Rgb {
  switch (effect) {
    case 'invert':
      return [clamp(255 - r), clamp(255 - g), clamp(255 - b)];
    case 'brighten':
      return [clamp(r + 60), clamp(g + 60), clamp(b + 60)];
    case 'darken':
      return [clamp(r - 60), clamp(g - 60), clamp(b - 60)];
    case 'tint': {
      const [tr, tg, tb] = tintColor ?? [255, 255, 0];
      return [clamp((r + tr) / 2), clamp((g + tg) / 2), clamp((b + tb) / 2)];
    }
    case 'glowSurround':
      return [r, g, b]; // interior pixels unchanged; border handled separately below
  }
}

export function applySelectedStateEffect(
  effect: SelectedStateEffect,
  palette: Rgb[],
  pixels: number[],
  width: number,
  height: number,
  tintColor?: Rgb,
): number[] {
  const remapCache = new Map<number, number>();
  const remap = (index: number): number => {
    const cached = remapCache.get(index);
    if (cached !== undefined) return cached;
    const transformed = transformColor(effect, palette[index], tintColor);
    const newIndex = nearestPaletteIndex(transformed, palette);
    remapCache.set(index, newIndex);
    return newIndex;
  };

  const result = pixels.map(remap);

  if (effect === 'glowSurround') {
    const brightestIndex = palette.reduce(
      (best, color, index) => {
        const brightness = color[0] + color[1] + color[2];
        return brightness > best.brightness ? { index, brightness } : best;
      },
      { index: 0, brightness: -1 },
    ).index;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (result[i] !== 0) continue; // only grow into background/transparent pixels
        const neighbors = [
          [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
        ];
        const touchesForeground = neighbors.some(([nx, ny]) => {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
          return result[ny * width + nx] !== 0;
        });
        if (touchesForeground) result[i] = brightestIndex;
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/image/selectedState.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/image/selectedState.ts client/src/lib/image/selectedState.test.ts
git commit -m "Add selected-state effect generator (invert/brighten/darken/tint/glow)"
```

---

### Task 10: KDE theme parsing

**Files:**
- Create: `client/src/lib/theme/themeParser.ts`
- Test: `client/src/lib/theme/themeParser.test.ts`

**Interfaces:**
- Consumes: `JSZip` (npm package, installed in Task 1).
- Produces: `interface ThemeIcon { name: string; category: string; sizePx: number; format: 'svg' | 'png'; zipPath: string }`; `async function parseTheme(zip: JSZip): Promise<ThemeIcon[]>` — walks every entry matching KDE's `<size>/<category>/<name>.(svg|png)` or `scalable/<category>/<name>.svg` layout, ignoring `index.theme` and any other files, deduplicating by name+category (preferring `scalable`/SVG over any fixed PNG size when both exist, since SVG is the better rasterization source).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseTheme } from './themeParser';

describe('parseTheme', () => {
  it('finds scalable SVG icons under <category>/<name>.svg', async () => {
    const zip = new JSZip();
    zip.file('index.theme', '[Icon Theme]\nName=Test');
    zip.file('scalable/places/folder.svg', '<svg></svg>');
    zip.file('scalable/apps/firefox.svg', '<svg></svg>');

    const icons = await parseTheme(zip);
    expect(icons).toHaveLength(2);
    expect(icons.map((i) => i.name).sort()).toEqual(['firefox', 'folder']);
    expect(icons[0].format).toBe('svg');
  });

  it('finds fixed-size PNG icons under <size>/<category>/<name>.png', async () => {
    const zip = new JSZip();
    zip.file('index.theme', '[Icon Theme]\nName=Test');
    zip.file('48x48/places/folder.png', new Uint8Array([1, 2, 3]));

    const icons = await parseTheme(zip);
    expect(icons).toHaveLength(1);
    expect(icons[0]).toMatchObject({ name: 'folder', category: 'places', sizePx: 48, format: 'png' });
  });

  it('prefers the scalable SVG over a fixed PNG of the same icon', async () => {
    const zip = new JSZip();
    zip.file('index.theme', '[Icon Theme]\nName=Test');
    zip.file('scalable/places/folder.svg', '<svg></svg>');
    zip.file('48x48/places/folder.png', new Uint8Array([1, 2, 3]));

    const icons = await parseTheme(zip);
    expect(icons).toHaveLength(1);
    expect(icons[0].format).toBe('svg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/theme/themeParser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
import type JSZip from 'jszip';

export interface ThemeIcon {
  name: string;
  category: string;
  sizePx: number;
  format: 'svg' | 'png';
  zipPath: string;
}

const SCALABLE_RE = /^scalable\/([^/]+)\/([^/]+)\.svg$/i;
const SIZED_RE = /^(\d+)x\d+\/([^/]+)\/([^/]+)\.(svg|png)$/i;

export async function parseTheme(zip: JSZip): Promise<ThemeIcon[]> {
  const byKey = new Map<string, ThemeIcon>();

  zip.forEach((relativePath) => {
    const scalableMatch = relativePath.match(SCALABLE_RE);
    if (scalableMatch) {
      const [, category, name] = scalableMatch;
      const key = `${category}/${name}`;
      byKey.set(key, { name, category, sizePx: 0, format: 'svg', zipPath: relativePath });
      return;
    }

    const sizedMatch = relativePath.match(SIZED_RE);
    if (sizedMatch) {
      const [, size, category, name, ext] = sizedMatch;
      const key = `${category}/${name}`;
      const existing = byKey.get(key);
      if (existing?.format === 'svg') return; // SVG already wins
      byKey.set(key, {
        name,
        category,
        sizePx: Number(size),
        format: ext.toLowerCase() as 'svg' | 'png',
        zipPath: relativePath,
      });
    }
  });

  return Array.from(byKey.values());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/theme/themeParser.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/theme/themeParser.ts client/src/lib/theme/themeParser.test.ts
git commit -m "Add KDE icon theme directory parser"
```

---

### Task 11: SVG/PNG decode to RgbaImage

**Files:**
- Create: `client/src/lib/image/decode.ts`
- Test: `client/src/lib/image/decode.test.ts`

**Interfaces:**
- Consumes: `RgbaImage` from `./quantize`. Uses the DOM `<canvas>`/`Image` APIs, which in tests resolve to the `canvas` npm package via jsdom (installed in Task 1).
- Produces: `async function rasterizeSvg(svgText: string, outputSizePx: number): Promise<RgbaImage>`; `async function decodePng(bytes: Uint8Array, outputSizePx: number): Promise<RgbaImage>`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { rasterizeSvg, decodePng } from './decode';

describe('rasterizeSvg', () => {
  it('rasterizes an SVG to the requested output size', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
      <rect width="24" height="24" fill="#ff0000"/>
    </svg>`;
    const image = await rasterizeSvg(svg, 16);
    expect(image.width).toBe(16);
    expect(image.height).toBe(16);
    // center pixel should be opaque red
    const centerIndex = (8 * 16 + 8) * 4;
    expect(image.data[centerIndex]).toBeGreaterThan(200);
    expect(image.data[centerIndex + 3]).toBe(255);
  });
});

describe('decodePng', () => {
  it('decodes and resizes a PNG to the requested output size', async () => {
    // 1x1 red PNG (well-known minimal fixture)
    const base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const image = await decodePng(bytes, 8);
    expect(image.width).toBe(8);
    expect(image.height).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/image/decode.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
import type { RgbaImage } from './quantize';

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawToRgbaImage(img: HTMLImageElement, outputSizePx: number): RgbaImage {
  const canvas = document.createElement('canvas');
  canvas.width = outputSizePx;
  canvas.height = outputSizePx;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, outputSizePx, outputSizePx);
  ctx.drawImage(img, 0, 0, outputSizePx, outputSizePx);
  const imageData = ctx.getImageData(0, 0, outputSizePx, outputSizePx);
  return { width: outputSizePx, height: outputSizePx, data: imageData.data };
}

export async function rasterizeSvg(svgText: string, outputSizePx: number): Promise<RgbaImage> {
  const blob = new Blob([svgText], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageElement(url);
    return drawToRgbaImage(img, outputSizePx);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function decodePng(bytes: Uint8Array, outputSizePx: number): Promise<RgbaImage> {
  const blob = new Blob([bytes], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageElement(url);
    return drawToRgbaImage(img, outputSizePx);
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

Add to `client/src/test/setup.ts` (needed because jsdom's `Image`/`canvas` need the `canvas` package's backing implementation):

```typescript
import '@testing-library/jest-dom/vitest';
import { installCanvas } from './installCanvas';

installCanvas();
```

Create `client/src/test/installCanvas.ts`:

```typescript
import { createCanvas, Image, loadImage } from 'canvas';

export function installCanvas(): void {
  // jsdom doesn't implement real 2D rendering; swap in the `canvas` package's
  // Node implementation so getImageData()/drawImage() produce real pixels in tests.
  (globalThis as any).HTMLCanvasElement.prototype.getContext = function (type: string) {
    const c = createCanvas(this.width, this.height);
    return c.getContext(type as '2d');
  };
  (globalThis as any).Image = Image;
  void loadImage; // available if a future test needs direct file loading
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/image/decode.test.ts`
Expected: PASS (2 tests)

If the `canvas` package's `Image` doesn't pick up `Blob`/`URL.createObjectURL` object URLs under jsdom, use a data URL instead (`FileReader` or manual base64) — adjust `rasterizeSvg`/`decodePng` to build a `data:image/svg+xml;base64,...` / `data:image/png;base64,...` URL rather than an object URL if the test fails with a load error. Data URLs work identically in real browsers, so this is safe either way.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/image/decode.ts client/src/lib/image/decode.test.ts client/src/test/installCanvas.ts client/src/test/setup.ts
git commit -m "Add SVG/PNG decoding to RgbaImage via canvas"
```

---

### Task 12: MDI badge fetch

**Files:**
- Create: `client/src/lib/badges/mdiBadges.ts`
- Test: `client/src/lib/badges/mdiBadges.test.ts`

**Interfaces:**
- Consumes: global `fetch`.
- Produces: `async function fetchMdiBadgeSvg(iconName: string, proxyBaseUrl?: string): Promise<string>` — tries `https://cdn.jsdelivr.net/npm/@mdi/svg/svg/<iconName>.svg` directly first; on any fetch failure (network error or non-2xx), if `proxyBaseUrl` is given, retries via `${proxyBaseUrl}?url=<encoded jsdelivr URL>`; otherwise throws a descriptive `Error`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchMdiBadgeSvg } from './mdiBadges';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchMdiBadgeSvg', () => {
  it('fetches directly from the jsdelivr CDN when it succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '<svg>music</svg>' });
    vi.stubGlobal('fetch', fetchMock);

    const svg = await fetchMdiBadgeSvg('music-note');
    expect(svg).toBe('<svg>music</svg>');
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.jsdelivr.net/npm/@mdi/svg/svg/music-note.svg');
  });

  it('falls back to the proxy when the direct fetch fails and a proxy URL is given', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({ ok: true, text: async () => '<svg>via-proxy</svg>' });
    vi.stubGlobal('fetch', fetchMock);

    const svg = await fetchMdiBadgeSvg('music-note', '/api/fetch-url');
    expect(svg).toBe('<svg>via-proxy</svg>');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/fetch-url?url=' + encodeURIComponent('https://cdn.jsdelivr.net/npm/@mdi/svg/svg/music-note.svg'),
    );
  });

  it('throws a descriptive error when both direct and proxy fetches fail', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMdiBadgeSvg('not-a-real-icon', '/api/fetch-url')).rejects.toThrow(
      /not-a-real-icon/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/badges/mdiBadges.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
const MDI_CDN_BASE = 'https://cdn.jsdelivr.net/npm/@mdi/svg/svg';

export async function fetchMdiBadgeSvg(iconName: string, proxyBaseUrl?: string): Promise<string> {
  const directUrl = `${MDI_CDN_BASE}/${iconName}.svg`;

  try {
    const response = await fetch(directUrl);
    if (response.ok) return response.text();
  } catch {
    // fall through to proxy attempt below
  }

  if (proxyBaseUrl) {
    const proxied = await fetch(`${proxyBaseUrl}?url=${encodeURIComponent(directUrl)}`);
    if (proxied.ok) return proxied.text();
  }

  throw new Error(`Could not fetch MDI badge "${iconName}" (direct fetch failed${proxyBaseUrl ? ' and proxy fetch failed' : ', no proxy configured'})`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/badges/mdiBadges.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/badges/mdiBadges.ts client/src/lib/badges/mdiBadges.test.ts
git commit -m "Add MDI badge SVG fetch with proxy fallback"
```

---

### Task 13: Badge compositor

**Files:**
- Create: `client/src/lib/badges/compositeBadge.ts`
- Test: `client/src/lib/badges/compositeBadge.test.ts`

**Interfaces:**
- Consumes: `RgbaImage` from `../image/quantize`; `rasterizeSvg` from `../image/decode` (to recolor+rasterize the badge SVG).
- Produces: `type BadgeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'`; `interface BadgeOptions { svgText: string; color: string; corner: BadgeCorner; scale: number; outline?: string; dropShadow?: boolean }` (`scale` is the badge's size as a fraction of the base icon's size, e.g. `0.4`); `async function compositeBadge(base: RgbaImage, options: BadgeOptions): Promise<RgbaImage>` — recolors the (monochrome) badge SVG by replacing its `fill`/`currentColor` with `options.color`, optionally adds a stroke outline and/or a soft drop shadow for legibility, rasterizes it at `base.width * scale`, and draws it onto a copy of `base` at the chosen corner.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { compositeBadge } from './compositeBadge';
import type { RgbaImage } from '../image/quantize';

function transparentImage(size: number): RgbaImage {
  return { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
}

const badgeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000000" d="M4 4h16v16H4z"/></svg>';

describe('compositeBadge', () => {
  it('returns an image the same size as the base', async () => {
    const base = transparentImage(32);
    const result = await compositeBadge(base, { svgText: badgeSvg, color: '#ff0000', corner: 'bottom-right', scale: 0.5 });
    expect(result.width).toBe(32);
    expect(result.height).toBe(32);
  });

  it('paints badge-colored pixels near the requested corner', async () => {
    const base = transparentImage(32);
    const result = await compositeBadge(base, { svgText: badgeSvg, color: '#ff0000', corner: 'bottom-right', scale: 0.5 });
    // bottom-right quadrant should now contain opaque red pixels
    const index = (28 * 32 + 28) * 4;
    expect(result.data[index]).toBeGreaterThan(200);
    expect(result.data[index + 3]).toBeGreaterThan(0);
  });

  it('leaves the top-left quadrant untouched when badge is bottom-right', async () => {
    const base = transparentImage(32);
    const result = await compositeBadge(base, { svgText: badgeSvg, color: '#ff0000', corner: 'bottom-right', scale: 0.5 });
    const index = (2 * 32 + 2) * 4;
    expect(result.data[index + 3]).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/badges/compositeBadge.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
import type { RgbaImage } from '../image/quantize';
import { rasterizeSvg } from '../image/decode';

export type BadgeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export interface BadgeOptions {
  svgText: string;
  color: string;
  corner: BadgeCorner;
  scale: number;
  outline?: string;
  dropShadow?: boolean;
}

function recolorSvg(svgText: string, color: string, outline?: string): string {
  let recolored = svgText.replace(/fill="[^"]*"/g, `fill="${color}"`).replace(/fill:\s*[^;"]+/g, `fill:${color}`);
  if (outline) {
    recolored = recolored.replace('<svg', `<svg stroke="${outline}" stroke-width="1"`);
  }
  return recolored;
}

function cornerOffset(corner: BadgeCorner, baseSize: number, badgeSize: number): { x: number; y: number } {
  const margin = 0;
  switch (corner) {
    case 'top-left': return { x: margin, y: margin };
    case 'top-right': return { x: baseSize - badgeSize - margin, y: margin };
    case 'bottom-left': return { x: margin, y: baseSize - badgeSize - margin };
    case 'bottom-right': return { x: baseSize - badgeSize - margin, y: baseSize - badgeSize - margin };
    case 'center': return { x: (baseSize - badgeSize) / 2, y: (baseSize - badgeSize) / 2 };
  }
}

export async function compositeBadge(base: RgbaImage, options: BadgeOptions): Promise<RgbaImage> {
  const { svgText, color, corner, scale, outline, dropShadow } = options;
  const badgeSize = Math.round(base.width * scale);
  const recoloredSvg = recolorSvg(svgText, color, outline);
  const badge = await rasterizeSvg(recoloredSvg, badgeSize);
  const { x: offsetX, y: offsetY } = cornerOffset(corner, base.width, badgeSize);

  const canvas = document.createElement('canvas');
  canvas.width = base.width;
  canvas.height = base.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(base.data, base.width, base.height), 0, 0);

  const badgeCanvas = document.createElement('canvas');
  badgeCanvas.width = badgeSize;
  badgeCanvas.height = badgeSize;
  const badgeCtx = badgeCanvas.getContext('2d')!;
  badgeCtx.putImageData(new ImageData(badge.data, badge.width, badge.height), 0, 0);

  if (dropShadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = Math.max(2, Math.round(badgeSize * 0.08));
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.drawImage(badgeCanvas, offsetX, offsetY);
    ctx.restore();
  } else {
    ctx.drawImage(badgeCanvas, offsetX, offsetY);
  }

  const composited = ctx.getImageData(0, 0, base.width, base.height);
  return { width: base.width, height: base.height, data: composited.data };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/badges/compositeBadge.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/badges/compositeBadge.ts client/src/lib/badges/compositeBadge.test.ts
git commit -m "Add MDI badge recoloring, placement, and legibility compositor"
```

---

### Task 14: Output zip builder with default-icon role tagging

**Files:**
- Create: `client/src/lib/output/zipBuilder.ts`
- Test: `client/src/lib/output/zipBuilder.test.ts`

**Interfaces:**
- Consumes: `IconKind` from `../newicons/diskObject`; `JSZip`.
- Produces: `interface ConvertedIcon { name: string; infoBytes: Uint8Array; role?: 'drawer' | 'disk' | 'tool' | 'project' | 'trashcan' }`; `async function buildOutputZip(icons: ConvertedIcon[]): Promise<Blob>` — places every icon as `<name>.info` at the zip root, additionally places any icon with a `role` as `Sys/def_<role>.info`, and adds a `README.txt` explaining the `Sys/` → `ENVARC:Sys/` + `ENV:Sys/` copy step, per spec.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildOutputZip } from './zipBuilder';

describe('buildOutputZip', () => {
  it('places every icon as <name>.info at the zip root', async () => {
    const blob = await buildOutputZip([
      { name: 'folder', infoBytes: new Uint8Array([1, 2, 3]) },
      { name: 'firefox', infoBytes: new Uint8Array([4, 5, 6]) },
    ]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file('folder.info')).not.toBeNull();
    expect(zip.file('firefox.info')).not.toBeNull();
  });

  it('additionally places role-tagged icons under Sys/def_<role>.info', async () => {
    const blob = await buildOutputZip([
      { name: 'folder', infoBytes: new Uint8Array([1, 2, 3]), role: 'drawer' },
    ]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file('folder.info')).not.toBeNull();
    expect(zip.file('Sys/def_drawer.info')).not.toBeNull();
  });

  it('includes a README explaining how to install Sys/ contents', async () => {
    const blob = await buildOutputZip([{ name: 'folder', infoBytes: new Uint8Array([1]) }]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const readme = await zip.file('README.txt')?.async('string');
    expect(readme).toMatch(/ENVARC:Sys/);
    expect(readme).toMatch(/ENV:Sys/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/output/zipBuilder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
import JSZip from 'jszip';

export interface ConvertedIcon {
  name: string;
  infoBytes: Uint8Array;
  role?: 'drawer' | 'disk' | 'tool' | 'project' | 'trashcan';
}

const README_TEXT = `kde2amiga converted icons
==========================

Each <name>.info file can be copied next to its matching drawer/file on your
Amiga and used immediately.

If any icons here were tagged as system-wide defaults, they're under Sys/
(e.g. Sys/def_drawer.info). To make them take effect immediately, copy the
contents of Sys/ to BOTH of these locations:

  ENVARC:Sys/   (persists across reboots)
  ENV:Sys/      (the live copy Workbench and Directory Opus 5 read right now)

Copying to ENVARC:Sys/ alone will only take effect after your next reboot.
`;

export async function buildOutputZip(icons: ConvertedIcon[]): Promise<Blob> {
  const zip = new JSZip();

  for (const icon of icons) {
    zip.file(`${icon.name}.info`, icon.infoBytes);
    if (icon.role) {
      zip.file(`Sys/def_${icon.role}.info`, icon.infoBytes);
    }
  }

  zip.file('README.txt', README_TEXT);

  return zip.generateAsync({ type: 'blob' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/output/zipBuilder.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/output/zipBuilder.ts client/src/lib/output/zipBuilder.test.ts
git commit -m "Add output zip builder with Sys/ default-icon role tagging"
```

---

### Task 15: Express proxy endpoint

**Files:**
- Modify: `server/src/index.ts`
- Create: `server/src/proxy.ts`
- Test: `server/src/proxy.test.ts`

**Interfaces:**
- Consumes: global `fetch` (Node 18+ has it built in).
- Produces: `const MAX_PROXY_BYTES = 25 * 1024 * 1024`; `function createFetchProxyHandler(): import('express').RequestHandler` mounted at `GET /api/fetch-url?url=<encoded>` — validates the `url` query param is present and `http(s)`, streams the response, aborts and returns `413` if it exceeds `MAX_PROXY_BYTES`, returns `502` on fetch failure, otherwise pipes the body through with the original `content-type`.

- [ ] **Step 1: Add a test runner to the server package**

```bash
cd server
npm install --save-dev vitest supertest @types/supertest
```

Add to `server/package.json` `scripts`: `"test": "vitest run"`.

- [ ] **Step 2: Write the failing test**

```typescript
// server/src/proxy.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFetchProxyHandler } from './proxy';

afterEach(() => {
  vi.restoreAllMocks();
});

function appWithProxy() {
  const app = express();
  app.get('/api/fetch-url', createFetchProxyHandler());
  return app;
}

describe('createFetchProxyHandler', () => {
  it('rejects requests missing the url parameter', async () => {
    const res = await request(appWithProxy()).get('/api/fetch-url');
    expect(res.status).toBe(400);
  });

  it('rejects non-http(s) URLs', async () => {
    const res = await request(appWithProxy()).get('/api/fetch-url?url=file:///etc/passwd');
    expect(res.status).toBe(400);
  });

  it('proxies a successful upstream response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/zip', 'content-length': '3' }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }),
    );

    const res = await request(appWithProxy()).get(
      '/api/fetch-url?url=' + encodeURIComponent('https://example.com/theme.zip'),
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
  });

  it('returns 413 when the upstream content-length exceeds the size cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/zip', 'content-length': String(100 * 1024 * 1024) }),
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    );

    const res = await request(appWithProxy()).get(
      '/api/fetch-url?url=' + encodeURIComponent('https://example.com/huge.zip'),
    );
    expect(res.status).toBe(413);
  });

  it('returns 502 when the upstream fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const res = await request(appWithProxy()).get(
      '/api/fetch-url?url=' + encodeURIComponent('https://example.com/theme.zip'),
    );
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && npx vitest run src/proxy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write the implementation**

```typescript
// server/src/proxy.ts
import type { RequestHandler } from 'express';

export const MAX_PROXY_BYTES = 25 * 1024 * 1024;

export function createFetchProxyHandler(): RequestHandler {
  return async (req, res) => {
    const rawUrl = req.query.url;
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
      res.status(400).json({ error: 'Missing required "url" query parameter' });
      return;
    }

    let target: URL;
    try {
      target = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      res.status(400).json({ error: 'Only http(s) URLs are allowed' });
      return;
    }

    let upstream: Response;
    try {
      upstream = await fetch(target.toString());
    } catch {
      res.status(502).json({ error: 'Failed to fetch the requested URL' });
      return;
    }

    if (!upstream.ok) {
      res.status(502).json({ error: `Upstream responded with status ${upstream.status}` });
      return;
    }

    const contentLength = Number(upstream.headers.get('content-length') ?? '0');
    if (contentLength > MAX_PROXY_BYTES) {
      res.status(413).json({ error: `Response exceeds the ${MAX_PROXY_BYTES}-byte size cap` });
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength > MAX_PROXY_BYTES) {
      res.status(413).json({ error: `Response exceeds the ${MAX_PROXY_BYTES}-byte size cap` });
      return;
    }

    res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/octet-stream');
    res.status(200).send(buffer);
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run src/proxy.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Wire the handler into the server**

Edit `server/src/index.ts`, adding the import and route before `app.listen`:

```typescript
import { createFetchProxyHandler } from './proxy.js';
```

```typescript
app.get('/api/fetch-url', createFetchProxyHandler());
```

- [ ] **Step 7: Commit**

```bash
git add server/src/proxy.ts server/src/proxy.test.ts server/src/index.ts server/package.json
git commit -m "Add Express theme-URL fetch proxy with size cap"
```

---

### Task 16: Pipeline orchestrator (ties every lib module together)

**Files:**
- Create: `client/src/lib/pipeline/convertJob.ts`
- Test: `client/src/lib/pipeline/convertJob.test.ts`

**Interfaces:**
- Consumes: `parseTheme` (Task 10), `rasterizeSvg`/`decodePng` (Task 11), `compositeBadge` (Task 13), `buildSharedPalette`/`mapImageToPalette` (Task 8), `applySelectedStateEffect` (Task 9), `buildInfoFile` (Task 7), `buildOutputZip` (Task 14).
- Produces: `interface JobIconInput { icon: ThemeIcon; kind: IconKind; role?: ConvertedIcon['role']; badge?: BadgeOptions }`; `interface JobConfig { outputSizePx: number; maxColors: number; selectedEffect: SelectedStateEffect; tintColor?: [number, number, number] }`; `async function runConversionJob(zip: JSZip, inputs: JobIconInput[], config: JobConfig, onProgress?: (done: number, total: number) => void): Promise<Blob>` — this is the function the UI (Task 17+) calls; it decodes each icon, applies its badge if present, builds one shared palette across all decoded (post-badge) images, maps each to indices, derives the selected state per the configured effect, builds each `.info` file, and returns the final zip `Blob`. Rasterization/decode failures for one icon are caught, logged via `onProgress`'s icon being skipped, and do not abort the batch (per spec's error-handling section).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { runConversionJob } from './convertJob';
import type { ThemeIcon } from '../theme/themeParser';

describe('runConversionJob', () => {
  it('produces a zip containing one .info file per input icon', async () => {
    const zip = new JSZip();
    zip.file('scalable/places/folder.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#0000ff"/></svg>');
    zip.file('scalable/apps/firefox.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#ff8800"/></svg>');

    const folderIcon: ThemeIcon = { name: 'folder', category: 'places', sizePx: 0, format: 'svg', zipPath: 'scalable/places/folder.svg' };
    const firefoxIcon: ThemeIcon = { name: 'firefox', category: 'apps', sizePx: 0, format: 'svg', zipPath: 'scalable/apps/firefox.svg' };

    const outputZip = await runConversionJob(
      zip,
      [
        { icon: folderIcon, kind: 'drawer', role: 'drawer' },
        { icon: firefoxIcon, kind: 'tool' },
      ],
      { outputSizePx: 32, maxColors: 16, selectedEffect: 'invert' },
    );

    const parsed = await JSZip.loadAsync(await outputZip.arrayBuffer());
    expect(parsed.file('folder.info')).not.toBeNull();
    expect(parsed.file('firefox.info')).not.toBeNull();
    expect(parsed.file('Sys/def_drawer.info')).not.toBeNull();
  });

  it('skips an icon that fails to decode without aborting the batch', async () => {
    const zip = new JSZip();
    zip.file('scalable/apps/broken.svg', 'not actually valid svg content <<<');
    zip.file('scalable/apps/ok.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#00ff00"/></svg>');

    const brokenIcon: ThemeIcon = { name: 'broken', category: 'apps', sizePx: 0, format: 'svg', zipPath: 'scalable/apps/broken.svg' };
    const okIcon: ThemeIcon = { name: 'ok', category: 'apps', sizePx: 0, format: 'svg', zipPath: 'scalable/apps/ok.svg' };

    const progressLog: Array<[number, number]> = [];
    const outputZip = await runConversionJob(
      zip,
      [{ icon: brokenIcon, kind: 'tool' }, { icon: okIcon, kind: 'tool' }],
      { outputSizePx: 32, maxColors: 16, selectedEffect: 'invert' },
      (done, total) => progressLog.push([done, total]),
    );

    const parsed = await JSZip.loadAsync(await outputZip.arrayBuffer());
    expect(parsed.file('ok.info')).not.toBeNull();
    expect(parsed.file('broken.info')).toBeNull();
    expect(progressLog[progressLog.length - 1]).toEqual([2, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/pipeline/convertJob.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
import type JSZip from 'jszip';
import type { ThemeIcon } from '../theme/themeParser';
import { rasterizeSvg, decodePng } from '../image/decode';
import { compositeBadge, type BadgeOptions } from '../badges/compositeBadge';
import { buildSharedPalette, mapImageToPalette, type RgbaImage } from '../image/quantize';
import { applySelectedStateEffect, type SelectedStateEffect } from '../image/selectedState';
import { buildInfoFile, type IconKind } from '../newicons/diskObject';
import { buildOutputZip, type ConvertedIcon } from '../output/zipBuilder';

export interface JobIconInput {
  icon: ThemeIcon;
  kind: IconKind;
  role?: ConvertedIcon['role'];
  badge?: BadgeOptions;
}

export interface JobConfig {
  outputSizePx: number;
  maxColors: number;
  selectedEffect: SelectedStateEffect;
  tintColor?: [number, number, number];
}

async function decodeThemeIcon(zip: JSZip, icon: ThemeIcon, outputSizePx: number): Promise<RgbaImage> {
  const file = zip.file(icon.zipPath);
  if (!file) throw new Error(`Icon file missing from zip: ${icon.zipPath}`);

  if (icon.format === 'svg') {
    const svgText = await file.async('string');
    return rasterizeSvg(svgText, outputSizePx);
  }
  const bytes = await file.async('uint8array');
  return decodePng(bytes, outputSizePx);
}

export async function runConversionJob(
  zip: JSZip,
  inputs: JobIconInput[],
  config: JobConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const decoded: Array<{ input: JobIconInput; image: RgbaImage }> = [];

  let attempted = 0;
  for (const input of inputs) {
    attempted++;
    try {
      let image = await decodeThemeIcon(zip, input.icon, config.outputSizePx);
      if (input.badge) {
        image = await compositeBadge(image, input.badge);
      }
      decoded.push({ input, image });
    } catch (error) {
      console.warn(`Skipping icon "${input.icon.name}": ${(error as Error).message}`);
    } finally {
      onProgress?.(attempted, inputs.length);
    }
  }

  const palette = buildSharedPalette(decoded.map((d) => d.image), config.maxColors);

  const convertedIcons: ConvertedIcon[] = decoded.map(({ input, image }, index) => {
    const normalPixels = mapImageToPalette(image, palette);
    const selectedPixels = applySelectedStateEffect(
      config.selectedEffect,
      palette,
      normalPixels,
      image.width,
      image.height,
      config.tintColor,
    );

    const infoBytes = buildInfoFile({
      width: image.width,
      height: image.height,
      kind: input.kind,
      normal: { width: image.width, height: image.height, transparent: true, palette, pixels: normalPixels },
      selected: { width: image.width, height: image.height, transparent: true, palette, pixels: selectedPixels },
    });

    onProgress?.(index + 1, decoded.length);

    return { name: input.icon.name, infoBytes, role: input.role };
  });

  return buildOutputZip(convertedIcons);
}
```

The decode loop reports progress once per attempt (via `attempted`, incremented unconditionally at the top of the loop), regardless of whether that attempt succeeds or is skipped — so `onProgress` always reaches `(inputs.length, inputs.length)` by the time the decode phase finishes, which is what the "skips a broken icon" test asserts.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/pipeline/convertJob.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/pipeline/convertJob.ts client/src/lib/pipeline/convertJob.test.ts
git commit -m "Add pipeline orchestrator wiring decode, badge, quantize, encode, and zip output"
```

---

### Task 17: Theme loader UI (upload + URL fetch)

**Files:**
- Create: `client/src/components/ThemeLoader.tsx`
- Test: `client/src/components/ThemeLoader.test.tsx`

**Interfaces:**
- Consumes: `parseTheme` (Task 10), `JSZip`.
- Produces: `function ThemeLoader(props: { onThemeLoaded: (zip: JSZip, icons: ThemeIcon[]) => void }): JSX.Element` — a file `<input type="file" accept=".zip">` plus a URL text field + "Fetch" button that calls `GET /api/fetch-url?url=...`, both paths ending in `parseTheme` and calling `onThemeLoaded`. Shows an inline error message (not a crash) on a bad zip or failed fetch.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import { ThemeLoader } from './ThemeLoader';

async function makeThemeZipFile(): Promise<File> {
  const zip = new JSZip();
  zip.file('scalable/places/folder.svg', '<svg></svg>');
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'theme.zip', { type: 'application/zip' });
}

describe('ThemeLoader', () => {
  it('parses an uploaded zip and reports the discovered icons', async () => {
    const onThemeLoaded = vi.fn();
    render(<ThemeLoader onThemeLoaded={onThemeLoaded} />);

    const file = await makeThemeZipFile();
    const input = screen.getByLabelText(/upload/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onThemeLoaded).toHaveBeenCalledTimes(1));
    const [, icons] = onThemeLoaded.mock.calls[0];
    expect(icons).toHaveLength(1);
    expect(icons[0].name).toBe('folder');
  });

  it('shows an inline error when the uploaded file is not a valid zip', async () => {
    const onThemeLoaded = vi.fn();
    render(<ThemeLoader onThemeLoaded={onThemeLoaded} />);

    const badFile = new File(['not a zip'], 'theme.zip', { type: 'application/zip' });
    const input = screen.getByLabelText(/upload/i);
    fireEvent.change(input, { target: { files: [badFile] } });

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onThemeLoaded).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/ThemeLoader.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
import { useState, type ChangeEvent } from 'react';
import JSZip from 'jszip';
import { parseTheme, type ThemeIcon } from '../lib/theme/themeParser';

export function ThemeLoader(props: { onThemeLoaded: (zip: JSZip, icons: ThemeIcon[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');

  async function loadFromZipData(data: ArrayBuffer | Blob) {
    try {
      const zip = await JSZip.loadAsync(data);
      const icons = await parseTheme(zip);
      if (icons.length === 0) {
        setError('No KDE-theme-shaped icons were found in this zip.');
        return;
      }
      setError(null);
      props.onThemeLoaded(zip, icons);
    } catch {
      setError('That file could not be read as a zip archive.');
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadFromZipData(await file.arrayBuffer());
  }

  async function handleFetchUrl() {
    if (!url) return;
    try {
      const response = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}`);
      if (!response.ok) {
        setError(`Could not fetch that URL (status ${response.status}).`);
        return;
      }
      await loadFromZipData(await response.blob());
    } catch {
      setError('Could not fetch that URL.');
    }
  }

  return (
    <div>
      <label htmlFor="theme-upload">Upload a theme zip</label>
      <input id="theme-upload" type="file" accept=".zip" onChange={handleFileChange} />

      <label htmlFor="theme-url">Or fetch from a URL</label>
      <input id="theme-url" type="text" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button type="button" onClick={handleFetchUrl}>Fetch</button>

      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/ThemeLoader.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ThemeLoader.tsx client/src/components/ThemeLoader.test.tsx
git commit -m "Add theme loader UI (zip upload or URL fetch)"
```

---

### Task 18: Icon gallery selection UI

**Files:**
- Create: `client/src/components/IconGallery.tsx`
- Test: `client/src/components/IconGallery.test.tsx`

**Interfaces:**
- Consumes: `ThemeIcon` (Task 10).
- Produces: `function IconGallery(props: { icons: ThemeIcon[]; selected: Set<string>; onSelectionChange: (selected: Set<string>) => void }): JSX.Element` — a checkbox list keyed by `category/name`, each labeled with the icon's name and category.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IconGallery } from './IconGallery';
import type { ThemeIcon } from '../lib/theme/themeParser';

const icons: ThemeIcon[] = [
  { name: 'folder', category: 'places', sizePx: 0, format: 'svg', zipPath: 'scalable/places/folder.svg' },
  { name: 'firefox', category: 'apps', sizePx: 0, format: 'svg', zipPath: 'scalable/apps/firefox.svg' },
];

describe('IconGallery', () => {
  it('renders one checkbox per icon, labeled with name and category', () => {
    render(<IconGallery icons={icons} selected={new Set()} onSelectionChange={vi.fn()} />);
    expect(screen.getByLabelText(/folder \(places\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/firefox \(apps\)/i)).toBeInTheDocument();
  });

  it('calls onSelectionChange with the toggled icon added to the selection', () => {
    const onSelectionChange = vi.fn();
    render(<IconGallery icons={icons} selected={new Set()} onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getByLabelText(/folder \(places\)/i));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['places/folder']));
  });

  it('calls onSelectionChange with the icon removed when unchecking an already-selected icon', () => {
    const onSelectionChange = vi.fn();
    render(
      <IconGallery icons={icons} selected={new Set(['places/folder'])} onSelectionChange={onSelectionChange} />,
    );
    fireEvent.click(screen.getByLabelText(/folder \(places\)/i));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/IconGallery.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
import type { ThemeIcon } from '../lib/theme/themeParser';

function keyOf(icon: ThemeIcon): string {
  return `${icon.category}/${icon.name}`;
}

export function IconGallery(props: {
  icons: ThemeIcon[];
  selected: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
}) {
  function toggle(key: string) {
    const next = new Set(props.selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    props.onSelectionChange(next);
  }

  return (
    <ul>
      {props.icons.map((icon) => {
        const key = keyOf(icon);
        const inputId = `icon-${key}`;
        return (
          <li key={key}>
            <input
              id={inputId}
              type="checkbox"
              checked={props.selected.has(key)}
              onChange={() => toggle(key)}
            />
            <label htmlFor={inputId}>{`${icon.name} (${icon.category})`}</label>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/IconGallery.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/IconGallery.tsx client/src/components/IconGallery.test.tsx
git commit -m "Add icon gallery selection UI"
```

---

### Task 19: Job config, role assignment, and convert/download UI

**Files:**
- Create: `client/src/components/JobConfigForm.tsx`
- Test: `client/src/components/JobConfigForm.test.tsx`

**Interfaces:**
- Consumes: `JobConfig` (Task 16), `SelectedStateEffect` (Task 9).
- Produces: `function JobConfigForm(props: { config: JobConfig; onChange: (config: JobConfig) => void }): JSX.Element` — numeric inputs for output size and max colors, a `<select>` for the selected-state effect.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JobConfigForm } from './JobConfigForm';
import type { JobConfig } from '../lib/pipeline/convertJob';

const baseConfig: JobConfig = { outputSizePx: 32, maxColors: 16, selectedEffect: 'invert' };

describe('JobConfigForm', () => {
  it('renders the current output size and max colors', () => {
    render(<JobConfigForm config={baseConfig} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/output size/i)).toHaveValue(32);
    expect(screen.getByLabelText(/max colors/i)).toHaveValue(16);
  });

  it('calls onChange with an updated selected-state effect', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={baseConfig} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/selected-state effect/i), { target: { value: 'glowSurround' } });
    expect(onChange).toHaveBeenCalledWith({ ...baseConfig, selectedEffect: 'glowSurround' });
  });

  it('calls onChange with an updated output size as a number', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={baseConfig} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/output size/i), { target: { value: '64' } });
    expect(onChange).toHaveBeenCalledWith({ ...baseConfig, outputSizePx: 64 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/JobConfigForm.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
import type { JobConfig } from '../lib/pipeline/convertJob';
import type { SelectedStateEffect } from '../lib/image/selectedState';

const EFFECTS: SelectedStateEffect[] = ['invert', 'brighten', 'darken', 'tint', 'glowSurround'];

export function JobConfigForm(props: { config: JobConfig; onChange: (config: JobConfig) => void }) {
  const { config, onChange } = props;

  return (
    <div>
      <label htmlFor="output-size">Output size (px)</label>
      <input
        id="output-size"
        type="number"
        value={config.outputSizePx}
        onChange={(e) => onChange({ ...config, outputSizePx: Number(e.target.value) })}
      />

      <label htmlFor="max-colors">Max colors</label>
      <input
        id="max-colors"
        type="number"
        value={config.maxColors}
        onChange={(e) => onChange({ ...config, maxColors: Number(e.target.value) })}
      />

      <label htmlFor="selected-effect">Selected-state effect</label>
      <select
        id="selected-effect"
        value={config.selectedEffect}
        onChange={(e) => onChange({ ...config, selectedEffect: e.target.value as SelectedStateEffect })}
      >
        {EFFECTS.map((effect) => (
          <option key={effect} value={effect}>
            {effect}
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/JobConfigForm.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/JobConfigForm.tsx client/src/components/JobConfigForm.test.tsx
git commit -m "Add job configuration form UI"
```

---

### Task 20: App orchestration and end-to-end integration test

**Files:**
- Modify: `client/src/App.tsx`
- Test: `client/src/App.test.tsx`

**Interfaces:**
- Consumes: every component and lib module from Tasks 10–19.
- Produces: the wired-up SPA — loads a theme, lets the user select icons, configure the job, run `runConversionJob`, and triggers a browser download of the resulting zip via an object URL.

- [ ] **Step 1: Write the failing integration test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import App from './App';

async function makeThemeZipFile(): Promise<File> {
  const zip = new JSZip();
  zip.file(
    'scalable/places/folder.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#3355ff"/></svg>',
  );
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'theme.zip', { type: 'application/zip' });
}

describe('App end-to-end', () => {
  it('loads a theme, selects an icon, converts it, and enables download', async () => {
    render(<App />);

    const file = await makeThemeZipFile();
    fireEvent.change(screen.getByLabelText(/upload/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText(/folder \(places\)/i)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/folder \(places\)/i));
    fireEvent.click(screen.getByRole('button', { name: /convert/i }));

    await waitFor(() => expect(screen.getByRole('link', { name: /download/i })).toBeInTheDocument(), {
      timeout: 5000,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/App.test.tsx`
Expected: FAIL — `App` doesn't yet render this flow

- [ ] **Step 3: Write the implementation**

```typescript
import { useState } from 'react';
import type JSZip from 'jszip';
import { ThemeLoader } from './components/ThemeLoader';
import { IconGallery } from './components/IconGallery';
import { JobConfigForm } from './components/JobConfigForm';
import type { ThemeIcon } from './lib/theme/themeParser';
import { runConversionJob, type JobConfig, type JobIconInput } from './lib/pipeline/convertJob';

const DEFAULT_CONFIG: JobConfig = { outputSizePx: 32, maxColors: 16, selectedEffect: 'invert' };

export default function App() {
  const [zip, setZip] = useState<JSZip | null>(null);
  const [icons, setIcons] = useState<ThemeIcon[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [config, setConfig] = useState<JobConfig>(DEFAULT_CONFIG);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  function handleThemeLoaded(loadedZip: JSZip, loadedIcons: ThemeIcon[]) {
    setZip(loadedZip);
    setIcons(loadedIcons);
    setSelected(new Set());
    setDownloadUrl(null);
  }

  async function handleConvert() {
    if (!zip) return;
    setConverting(true);
    try {
      const inputs: JobIconInput[] = icons
        .filter((icon) => selected.has(`${icon.category}/${icon.name}`))
        .map((icon) => ({ icon, kind: 'project' as const }));

      const blob = await runConversionJob(zip, inputs, config);
      setDownloadUrl(URL.createObjectURL(blob));
    } finally {
      setConverting(false);
    }
  }

  return (
    <div>
      <h1>kde2amiga</h1>
      <ThemeLoader onThemeLoaded={handleThemeLoaded} />
      {icons.length > 0 && (
        <>
          <IconGallery icons={icons} selected={selected} onSelectionChange={setSelected} />
          <JobConfigForm config={config} onChange={setConfig} />
          <button type="button" onClick={handleConvert} disabled={selected.size === 0 || converting}>
            Convert
          </button>
        </>
      )}
      {downloadUrl && (
        <a href={downloadUrl} download="kde2amiga-icons.zip">
          Download
        </a>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/App.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Run the full client test suite**

Run: `cd client && npm test`
Expected: PASS (all tests across every task)

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/App.test.tsx
git commit -m "Wire up end-to-end conversion pipeline in App"
```

---

## Deferred to future work (per spec's Non-goals / Deployment sections)

- Docker packaging and Unraid deployment.
- Role-assignment UI (Task 20's App wires `kind: 'project'` unconditionally and omits `role`; a small follow-up task can add a per-icon "kind" selector and role-assignment checkboxes reusing `IconGallery`'s selection pattern, plus a `BadgeEditor` component wiring Task 12/13's badge fetch+composite into `JobIconInput.badge` — both are straightforward UI-only additions once the pipeline in Task 16 is proven, deliberately left out of this plan to keep it focused on the novel/risky binary-format and image-pipeline work).
- Manual verification against the real A1200 (copy a converted batch over SMB, confirm Directory Opus 5 renders normal/selected states and that tagged `def_*.info` files apply) — this is manual hardware testing outside the scope of an automated task list, but should happen before calling v1 "done."

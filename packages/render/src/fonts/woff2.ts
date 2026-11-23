import { brotliDecompressSync } from 'node:zlib';

// Reads which characters a WOFF2 font draws, from its `cmap` table (W3C WOFF2 §5–6, OpenType `cmap` formats 4 and
// 12). Only what the coverage check needs: no glyphs, no layout tables.

const SIGNATURE = 0x774f4632; // 'wOF2'
const COLLECTION = 0x74746366; // 'ttcf'
const HEADER_SIZE = 48;
// Indexes in WOFF2's known-tag table.
const CMAP = 0;
const GLYF = 10;
const LOCA = 11;
const ARBITRARY_TAG = 63;
/** Decompressed font data larger than this is refused (a launch font's subset is under 200 KB). */
const MAX_DECOMPRESSED = 32 * 1024 * 1024;
/** At most this many cmap entries are read, so overlapping ranges can't make the reading slow. */
const MAX_ENTRIES = 2 * 0x110000;

class Woff2Error extends Error {
  constructor(message: string) {
    super(`not a WOFF2 file we can read: ${message}`);
  }
}

/** Big-endian reads at a byte offset, failing with a Woff2Error instead of reading past the end. */
class Bytes {
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.view.byteLength;
  }

  private check(at: number, size: number): void {
    if (!Number.isInteger(at) || at < 0 || at + size > this.view.byteLength)
      throw new Woff2Error('truncated');
  }

  u8(at: number): number {
    this.check(at, 1);
    return this.view.getUint8(at);
  }

  u16(at: number): number {
    this.check(at, 2);
    return this.view.getUint16(at);
  }

  u32(at: number): number {
    this.check(at, 4);
    return this.view.getUint32(at);
  }
}

/** WOFF2's UIntBase128 at `at`: 1 to 5 bytes, 7 bits each, no leading zeros, at most 2^32 - 1. */
function base128(bytes: Bytes, at: number): { value: number; next: number } {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = bytes.u8(at + i);
    if (i === 0 && byte === 0x80) throw new Woff2Error('bad UIntBase128');
    if (value > 0x01ffffff) throw new Woff2Error('UIntBase128 overflow');
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, next: at + i + 1 };
  }
  throw new Woff2Error('UIntBase128 too long');
}

/** The bytes of the font's `cmap` table, decompressed. */
function cmapTable(woff2: Uint8Array): Bytes {
  const file = new Bytes(woff2);
  if (file.length < HEADER_SIZE || file.u32(0) !== SIGNATURE) throw new Woff2Error('bad signature');
  if (file.u32(4) === COLLECTION) throw new Woff2Error('font collections are not supported');
  const numTables = file.u16(12);
  const totalCompressedSize = file.u32(20);

  // The table directory; the tables follow each other in the decompressed stream in this order.
  let at = HEADER_SIZE;
  let streamOffset = 0;
  let cmap: { start: number; length: number } | undefined;
  for (let i = 0; i < numTables; i++) {
    const flags = file.u8(at);
    at += 1;
    const known = flags & 0x3f;
    if (known === ARBITRARY_TAG) at += 4; // an arbitrary tag is never cmap, glyf or loca
    const transform = flags >> 6;
    const glyfOrLoca = known === GLYF || known === LOCA;
    const transformed = glyfOrLoca ? transform !== 3 : transform !== 0;
    const orig = base128(file, at);
    let length = orig.value;
    at = orig.next;
    if (transformed) {
      const stored = base128(file, at);
      length = stored.value;
      at = stored.next;
    }
    if (known === CMAP) {
      if (transformed) throw new Woff2Error('transformed cmap');
      cmap = { start: streamOffset, length };
    }
    streamOffset += length;
  }
  if (cmap === undefined) throw new Woff2Error('no cmap table');
  if (at + totalCompressedSize > file.length) throw new Woff2Error('truncated');

  let stream: Buffer;
  try {
    stream = brotliDecompressSync(woff2.subarray(at, at + totalCompressedSize), {
      maxOutputLength: MAX_DECOMPRESSED,
    });
  } catch {
    throw new Woff2Error('bad compressed data');
  }
  if (cmap.start + cmap.length > stream.byteLength) throw new Woff2Error('truncated');
  return new Bytes(stream.subarray(cmap.start, cmap.start + cmap.length));
}

/** Every code point the font maps to a glyph other than `.notdef`, from its Unicode `cmap` subtables. */
export function mappedCodePoints(woff2: Uint8Array): Set<number> {
  const cmap = cmapTable(woff2);
  const mapped = new Set<number>();
  let entries = 0;
  const count = () => {
    if (++entries > MAX_ENTRIES) throw new Woff2Error('too many cmap entries');
  };

  /** Format 4: segments of 16-bit code points, each mapped by a delta or through the glyph id array. */
  const format4 = (start: number) => {
    const segCount = cmap.u16(start + 6) / 2;
    const endCodes = start + 14;
    const startCodes = endCodes + segCount * 2 + 2;
    const idDeltas = startCodes + segCount * 2;
    const idRangeOffsets = idDeltas + segCount * 2;
    for (let s = 0; s < segCount; s++) {
      const end = cmap.u16(endCodes + s * 2);
      const first = cmap.u16(startCodes + s * 2);
      const delta = cmap.u16(idDeltas + s * 2);
      const rangeAt = idRangeOffsets + s * 2;
      const rangeOffset = cmap.u16(rangeAt);
      for (let code = first; code <= end && code !== 0xffff; code++) {
        count();
        const raw = rangeOffset === 0 ? code : cmap.u16(rangeAt + rangeOffset + (code - first) * 2);
        const glyph = rangeOffset !== 0 && raw === 0 ? 0 : (raw + delta) & 0xffff;
        if (glyph !== 0) mapped.add(code);
      }
    }
  };

  /** Format 12: groups of 32-bit code points with consecutive glyph ids. */
  const format12 = (start: number) => {
    const groups = cmap.u32(start + 12);
    for (let g = 0; g < groups; g++) {
      const at = start + 16 + g * 12;
      const first = cmap.u32(at);
      const end = Math.min(cmap.u32(at + 4), 0x10ffff);
      const firstGlyph = cmap.u32(at + 8);
      for (let code = first; code <= end; code++) {
        count();
        if (firstGlyph + (code - first) !== 0) mapped.add(code);
      }
    }
  };

  const numTables = cmap.u16(2);
  for (let i = 0; i < numTables; i++) {
    const record = 4 + i * 8;
    const platform = cmap.u16(record);
    const encoding = cmap.u16(record + 2);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const start = cmap.u32(record + 4);
    const format = cmap.u16(start);
    if (format === 4) format4(start);
    else if (format === 12) format12(start);
  }
  return mapped;
}

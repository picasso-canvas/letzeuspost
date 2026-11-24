import { crc32, deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { comparePng, decodePng, encodePng, type Pixels } from './png.ts';

// The exact pixel comparison the golden renders are held to (§08: no tolerance). Playwright's own image comparison
// skips pixels it takes for anti-aliasing, so it can't be exact; these check ours. They need no browser.

/** A PNG chunk: length, type, data and the CRC of type and data. */
function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG written by hand: the rows given as they are stored, each already starting with its filter byte. */
function handmade(
  header: { width: number; height: number; depth?: number; colour: number; interlace?: number },
  rows: readonly number[][],
): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(header.width, 0);
  ihdr.writeUInt32BE(header.height, 4);
  ihdr.writeUInt8(header.depth ?? 8, 8);
  ihdr.writeUInt8(header.colour, 9);
  ihdr.writeUInt8(header.interlace ?? 0, 12);
  const data = deflateSync(Buffer.from(rows.flat()));
  // The image data split over two IDAT chunks, as encoders may write it.
  const half = Math.floor(data.length / 2);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', data.subarray(0, half)),
    chunk('IDAT', data.subarray(half)),
    chunk('IEND', new Uint8Array()),
  ]);
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** The row `raw` stored with `filter` (PNG's five filters), given the raw row above it and the bytes per pixel. */
function filtered(filter: number, raw: number[], above: number[], bpp: number): number[] {
  const out = raw.map((x, i) => {
    const a = i >= bpp ? (raw[i - bpp] ?? 0) : 0;
    const b = above[i] ?? 0;
    const c = i >= bpp ? (above[i - bpp] ?? 0) : 0;
    const predicted = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter] ?? 0;
    return (x - predicted + 256) % 256;
  });
  return [filter, ...out];
}

/** A 3 × 5 RGBA image, every byte different, so a wrong predictor shows. */
const RGBA_ROWS = Array.from({ length: 5 }, (_, y) =>
  Array.from({ length: 3 * 4 }, (_, i) => (y * 53 + i * 29 + 7) % 256),
);

test('reads each of the five PNG filters back to the same pixels', () => {
  const rows = RGBA_ROWS.map((raw, y) => filtered(y, raw, RGBA_ROWS[y - 1] ?? [], 4));
  const decoded = decodePng(handmade({ width: 3, height: 5, colour: 6 }, rows));
  expect(decoded.width).toBe(3);
  expect(decoded.height).toBe(5);
  expect([...decoded.rgba]).toEqual(RGBA_ROWS.flat());
});

test('reads an RGB image with every pixel opaque', () => {
  const raw = [
    [10, 20, 30, 40, 50, 60],
    [70, 80, 90, 100, 110, 120],
  ];
  const rows = raw.map((row, y) => filtered(y === 0 ? 1 : 4, row, raw[y - 1] ?? [], 3));
  const decoded = decodePng(handmade({ width: 2, height: 2, colour: 2 }, rows));
  expect([...decoded.rgba]).toEqual([
    10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
  ]);
});

test('refuses what it can’t read exactly: not a PNG, 16-bit, palette, interlaced', () => {
  expect(() => decodePng(Buffer.from('GIF89a'))).toThrow(/not a PNG/);
  const row = [0, 1, 2, 3, 4, 5, 6];
  expect(() => decodePng(handmade({ width: 1, height: 1, depth: 16, colour: 2 }, [row]))).toThrow(
    /8-bit/,
  );
  expect(() => decodePng(handmade({ width: 1, height: 1, colour: 3 }, [[0, 0]]))).toThrow(
    /colour type 3/,
  );
  expect(() =>
    decodePng(handmade({ width: 1, height: 1, colour: 2, interlace: 1 }, [[0, 1, 2, 3]])),
  ).toThrow(/interlaced/);
});

test('what it writes, it reads back pixel for pixel', () => {
  const image: Pixels = { width: 3, height: 5, rgba: Uint8Array.from(RGBA_ROWS.flat()) };
  const png = encodePng(image);
  expect(Buffer.from(png).subarray(0, 8)).toEqual(SIGNATURE);
  expect(decodePng(png)).toEqual(image);
});

/** A 4 × 2 image, opaque, in one grey. */
const grey = (): Pixels => ({ width: 4, height: 2, rgba: new Uint8Array(4 * 2 * 4).fill(128) });

test('the same pixels are equal, even in differently encoded files', () => {
  const image = grey();
  const raw = [0, 1].map((y) => [...image.rgba.subarray(y * 16, y * 16 + 16)]);
  // Stored with the Up filter, where encodePng stores rows unfiltered: other bytes, the same pixels.
  const stored = handmade(
    { width: 4, height: 2, colour: 6 },
    raw.map((row, y) => filtered(2, row, raw[y - 1] ?? [], 4)),
  );
  expect(Buffer.from(stored).equals(Buffer.from(encodePng(image)))).toBe(false);
  expect(comparePng(stored, encodePng(image))).toEqual({
    equal: true,
    width: 4,
    height: 2,
    differing: 0,
  });
});

test('one channel of one pixel off by one is a difference, marked in the diff image', () => {
  const before = grey();
  const after = grey();
  after.rgba[(1 * 4 + 2) * 4 + 1] = 129; // the pixel at (2, 1), its green
  const result = comparePng(encodePng(before), encodePng(after));
  expect(result).toMatchObject({ equal: false, width: 4, height: 2, differing: 1 });
  if (result.diff === undefined) throw new Error('a diff image');
  const diff = decodePng(result.diff);
  expect([diff.width, diff.height]).toEqual([4, 2]);
  const at = (x: number, y: number) => [
    ...diff.rgba.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4),
  ];
  expect(at(2, 1)).toEqual([255, 0, 0, 255]);
  expect(at(0, 0)).not.toEqual([255, 0, 0, 255]);
});

test('an alpha change is a difference too', () => {
  const after = grey();
  after.rgba[3] = 127;
  expect(comparePng(encodePng(grey()), encodePng(after))).toMatchObject({ differing: 1 });
});

test('images of different sizes are never equal', () => {
  const wide: Pixels = { width: 8, height: 1, rgba: new Uint8Array(8 * 4).fill(128) };
  expect(comparePng(encodePng(grey()), encodePng(wide))).toMatchObject({
    equal: false,
    differing: 8,
    size: 'the baseline is 4 × 2 px, the render 8 × 1 px',
  });
});

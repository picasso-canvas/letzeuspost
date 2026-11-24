import { crc32, deflateSync, inflateSync } from 'node:zlib';

// Exact pixel comparison for the golden renders (§08: no tolerance). Playwright's own image comparison skips pixels it
// takes for anti-aliasing, so a changed glyph edge could pass it; this one counts every channel of every pixel. It
// reads what Chrome's screenshots are (8-bit RGB or RGBA, not interlaced) and refuses anything else rather than guess.

/** An image as rows of RGBA bytes, top to bottom. */
export type Pixels = { width: number; height: number; rgba: Uint8Array };

export type Comparison = {
  equal: boolean;
  width: number;
  height: number;
  /** Pixels whose RGBA differs in any channel; every pixel of the larger image when the sizes differ. */
  differing: number;
  /** The render faded to grey with each differing pixel in red, when the sizes match and a pixel differs. */
  diff?: Uint8Array;
  /** Why no pixel could be compared: the sizes differ. */
  size?: string;
};

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RGB = 2;
const RGBA = 6;

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Reads an 8-bit RGB or RGBA PNG that isn't interlaced; throws for any other. */
export function decodePng(png: Uint8Array): Pixels {
  const file = Buffer.from(png);
  if (file.length < 8 || !file.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let colour = -1;
  const data: Buffer[] = [];
  for (let at = 8; at + 8 <= file.length;) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body.readUInt8(8);
      colour = body.readUInt8(9);
      if (depth !== 8) throw new Error(`a ${String(depth)}-bit PNG; only 8-bit is read`);
      if (colour !== RGB && colour !== RGBA)
        throw new Error(`a PNG of colour type ${String(colour)}; only RGB and RGBA are read`);
      if (body.readUInt8(12) !== 0) throw new Error('an interlaced PNG; only plain ones are read');
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (colour === -1) throw new Error('a PNG with no header');

  const bpp = colour === RGBA ? 4 : 3;
  const stride = width * bpp;
  const stored = inflateSync(Buffer.concat(data));
  if (stored.length !== (stride + 1) * height) throw new Error('a PNG whose data is cut short');
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = stored[y * (stride + 1)] ?? 0;
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = stored[y * (stride + 1) + 1 + i] ?? 0;
      const a = i >= bpp ? (raw[row + i - bpp] ?? 0) : 0;
      const b = y > 0 ? (raw[row - stride + i] ?? 0) : 0;
      const c = i >= bpp && y > 0 ? (raw[row - stride + i - bpp] ?? 0) : 0;
      const predicted = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      if (predicted === undefined) throw new Error(`a PNG row with filter ${String(filter)}`);
      raw[row + i] = (x + predicted) % 256;
    }
  }
  if (colour === RGBA) return { width, height, rgba: raw };
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba.set(raw.subarray(p * 3, p * 3 + 3), p * 4);
    rgba[p * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}

/** Writes an 8-bit RGBA PNG, every row unfiltered. */
export function encodePng({ width, height, rgba }: Pixels): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(RGBA, 9);
  const stride = width * 4;
  const rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++)
    rows.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** Compares two PNGs pixel for pixel, with no tolerance; the diff image is drawn from `render`. */
export function comparePng(baseline: Uint8Array, render: Uint8Array): Comparison {
  const before = decodePng(baseline);
  const after = decodePng(render);
  if (before.width !== after.width || before.height !== after.height)
    return {
      equal: false,
      width: after.width,
      height: after.height,
      differing: Math.max(before.width * before.height, after.width * after.height),
      size: `the baseline is ${String(before.width)} × ${String(before.height)} px, the render ${String(after.width)} × ${String(after.height)} px`,
    };

  const diff = new Uint8Array(after.rgba.length);
  let differing = 0;
  for (let p = 0; p < after.rgba.length; p += 4) {
    let same = true;
    for (let c = 0; c < 4; c++) if (before.rgba[p + c] !== after.rgba[p + c]) same = false;
    if (same) {
      // The render's luminance, faded most of the way to white, so the red marks stand out.
      const [r = 0, g = 0, b = 0] = after.rgba.subarray(p, p + 3);
      diff.fill(Math.round(255 - (255 - (0.299 * r + 0.587 * g + 0.114 * b)) * 0.1), p, p + 3);
      diff[p + 3] = 255;
    } else {
      differing++;
      diff.set([255, 0, 0, 255], p);
    }
  }
  const { width, height } = after;
  return differing === 0
    ? { equal: true, width, height, differing }
    : { equal: false, width, height, differing, diff: encodePng({ width, height, rgba: diff }) };
}

// Pictures for the asset job's tests (#402), made from bytes here: the worker has no image library of its own, and a
// PNG is a few chunks around zlib's output. Each picture is a pattern drawn from a seed: two seeds give pictures whose
// perceptual hashes are far apart, and `touched` changes a corner of one, which leaves its hash within a few bits.
// Only tests import this file.
import { crc32, deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** An RGB PNG of `width` × `height` whose pixel at (x, y) is `colour(x, y)`. */
export function png(
  width: number,
  height: number,
  colour: (x: number, y: number) => readonly [number, number, number],
): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // 8 bits a channel
  header.writeUInt8(2, 9); // RGB
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const start = y * (1 + width * 3); // each row starts with its filter byte, 0: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colour(x, y);
      rows.writeUInt8(r, start + 1 + x * 3);
      rows.writeUInt8(g, start + 2 + x * 3);
      rows.writeUInt8(b, start + 3 + x * 3);
    }
  }
  return new Uint8Array(
    Buffer.concat([
      SIGNATURE,
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

const SIDE = 240;
const level = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/** A picture of bands and waves that `seed` shifts and turns: another seed is another picture. */
function pattern(seed: number, x: number, y: number): readonly [number, number, number] {
  const wave = Math.sin((x * (seed + 2)) / 31 + seed) * Math.cos((y * (seed + 3)) / 23 - seed);
  const grey = 128 + 120 * wave;
  return [level(grey), level(255 - grey), level((x + y + seed * 40) % 256)];
}

/** A photo-like picture drawn from `seed`. */
export function picture(seed: number): Uint8Array {
  return png(SIDE, SIDE, (x, y) => pattern(seed, x, y));
}

/** `picture(seed)` with a small square in one corner painted white: another file, nearly the same picture. */
export function touched(seed: number): Uint8Array {
  return png(SIDE, SIDE, (x, y) => (x < 12 && y < 12 ? [255, 255, 255] : pattern(seed, x, y)));
}

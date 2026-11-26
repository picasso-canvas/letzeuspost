// The asset job's test pictures do what its duplicate tests rely on (./asset.int.test.ts): `touched` is within
// DUPLICATE_MAX_BITS of its picture, and the pictures of different seeds are all further apart than that, so no two of
// them count as the same picture by chance.
import { DUPLICATE_MAX_BITS } from '@lzp/db';
import { processImage } from '@lzp/storage';
import { describe, expect, it } from 'vitest';
import { picture, touched } from './asset-fixtures.ts';

/** How many of the 64 bits two perceptual hashes differ in. */
function distance(a: string, b: string): number {
  let bits = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (bits > 0n) {
    count += Number(bits & 1n);
    bits >>= 1n;
  }
  return count;
}

const hashOf = async (bytes: Uint8Array) => (await processImage(bytes)).perceptualHash;

// Every seed the worker's asset tests use.
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 21, 22, 23, 24, 25, 26, 31];

describe('the asset job’s test pictures', { timeout: 60_000 }, () => {
  it('a touched picture is another file within the duplicate bound of its own', async () => {
    const [own, near] = await Promise.all([hashOf(picture(22)), hashOf(touched(22))]);
    expect(Buffer.from(picture(22)).equals(Buffer.from(touched(22)))).toBe(false);
    expect(distance(own, near)).toBeLessThanOrEqual(DUPLICATE_MAX_BITS);
  });

  it('pictures of different seeds are further apart than the bound', async () => {
    const hashes = await Promise.all(SEEDS.map((seed) => hashOf(picture(seed))));
    const close: string[] = [];
    hashes.forEach((a, i) => {
      hashes.slice(i + 1).forEach((b, j) => {
        if (distance(a, b) <= DUPLICATE_MAX_BITS) {
          close.push(`${String(SEEDS[i])} and ${String(SEEDS[i + 1 + j])}`);
        }
      });
    });
    expect(close).toEqual([]);
  });
});

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { JPEG_QUALITIES, MAX_JPEG_BYTES, toJpeg, toPng, toThumbnail } from './images.ts';

// The image outputs (§08 Outputs), read back with sharp: what an exported file carries, not how it was asked for.

/** A slide-like PNG master: a coloured ground with coloured text, the case chroma subsampling would blur. */
async function master(width = 1080, height = 1350): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}">
    <rect width="100%" height="100%" fill="#fff8f0"/>
    <text x="64" y="400" font-size="96" fill="#e4572e">Pitha is older than tea</text>
    <text x="64" y="520" font-size="40" fill="#17bebb">Rice cakes were made here for centuries.</text>
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

/** A master that carries EXIF, XMP and a text chunk, none of which may reach an export. */
async function masterWithMetadata(): Promise<Uint8Array> {
  const png = await sharp(await master())
    .withExif({ IFD0: { Copyright: 'Someone', Artist: 'A person' } })
    .withXmp(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>',
    )
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

/** A master of seeded noise (xorshift32, so every run is the same image): JPEG can't compress it. */
async function noise(width: number, height: number): Promise<Uint8Array> {
  const pixels = Buffer.alloc(width * height * 3);
  let state = 0x9e3779b9;
  for (let i = 0; i < pixels.length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    pixels[i] = state & 0xff;
  }
  const png = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

const metadataOf = (data: Uint8Array) => sharp(data).metadata();
const ascii = (data: Uint8Array | undefined) => Buffer.from(data ?? []).toString('latin1');

/** What no exported image may carry besides its colour profile (§08: no other metadata). */
function expectNoOtherMetadata(meta: sharp.Metadata): void {
  expect(meta.exif).toBeUndefined();
  expect(meta.xmp).toBeUndefined();
  expect(meta.iptc).toBeUndefined();
  expect(meta.comments ?? []).toEqual([]);
}

/** An sRGB colour profile is embedded, and the pixels are in sRGB. */
function expectSrgb(meta: sharp.Metadata): void {
  expect(meta.space).toBe('srgb');
  expect(meta.icc).toBeDefined();
  expect(ascii(meta.icc)).toContain('sRGB');
}

describe('toJpeg', () => {
  it('is an sRGB, 4:4:4, progressive JPEG at quality 90 with no other metadata, under 5 MB', async () => {
    const { data, quality } = await toJpeg(await masterWithMetadata());
    const meta = await metadataOf(data);
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([1080, 1350]);
    expectSrgb(meta);
    expect(meta.chromaSubsampling).toBe('4:4:4');
    expect(meta.isProgressive).toBe(true);
    expectNoOtherMetadata(meta);
    expect(quality).toBe(90);
    expect(data.byteLength).toBeLessThan(MAX_JPEG_BYTES);
  });

  it('steps the quality to 85 when the JPEG at 90 is over 5 MB', async () => {
    const image = await noise(1800, 1800);
    const at90 = await sharp(image)
      .jpeg({ quality: 90, chromaSubsampling: '4:4:4', progressive: true })
      .toBuffer();
    expect(at90.byteLength).toBeGreaterThan(MAX_JPEG_BYTES);

    const { data, quality } = await toJpeg(image);
    expect(quality).toBe(85);
    expect(data.byteLength).toBeLessThan(MAX_JPEG_BYTES);
    const meta = await metadataOf(data);
    expect(meta.chromaSubsampling).toBe('4:4:4');
    expect(meta.isProgressive).toBe(true);
  });

  it('steps on to 80 when 85 is still over 5 MB', async () => {
    const { data, quality } = await toJpeg(await noise(1950, 1950));
    expect(quality).toBe(80);
    expect(data.byteLength).toBeLessThan(MAX_JPEG_BYTES);
  });

  it('fails, rather than export a file over 5 MB, when even quality 80 is over', async () => {
    await expect(toJpeg(await noise(2400, 2400))).rejects.toThrow(/5 MB/);
  });

  it('tries the qualities §08 names, in order', () => {
    expect(JPEG_QUALITIES).toEqual([90, 85, 80]);
    expect(MAX_JPEG_BYTES).toBeLessThanOrEqual(5 * 1000 * 1000);
  });

  it('refuses a master that is not a PNG', async () => {
    const jpeg = await sharp(await master())
      .jpeg()
      .toBuffer();
    await expect(toJpeg(new Uint8Array(jpeg))).rejects.toThrow(/PNG master/);
  });
});

describe('toPng', () => {
  it('is the master, pixel for pixel, with its sRGB profile and no other metadata', async () => {
    const source = await masterWithMetadata();
    const png = await toPng(source);
    const meta = await metadataOf(png);
    expect(meta.format).toBe('png');
    expect([meta.width, meta.height]).toEqual([1080, 1350]);
    expectSrgb(meta);
    expectNoOtherMetadata(meta);
    const [before, after] = await Promise.all(
      [source, png].map((data) => sharp(data).ensureAlpha().raw().toBuffer()),
    );
    expect(after?.equals(before ?? Buffer.alloc(0))).toBe(true);
  });

  it('refuses a master that is not a PNG', async () => {
    const webp = await sharp(await master())
      .webp()
      .toBuffer();
    await expect(toPng(new Uint8Array(webp))).rejects.toThrow(/PNG master/);
  });
});

describe('toThumbnail', () => {
  it('is a 360 px wide WebP at the master’s proportions, sRGB, with no other metadata', async () => {
    const thumbnail = await toThumbnail(await masterWithMetadata());
    const meta = await metadataOf(thumbnail);
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([360, 450]);
    expectSrgb(meta);
    expectNoOtherMetadata(meta);
  });

  it('keeps each size’s proportions: a story is 360 × 640, a landscape 360 × 203', async () => {
    const story = await metadataOf(await toThumbnail(await master(1080, 1920)));
    const landscape = await metadataOf(await toThumbnail(await master(1200, 675)));
    expect([story.width, story.height]).toEqual([360, 640]);
    expect([landscape.width, landscape.height]).toEqual([360, 203]);
  });

  it('refuses a master that is not a PNG', async () => {
    const jpeg = await sharp(await master())
      .jpeg()
      .toBuffer();
    await expect(toThumbnail(new Uint8Array(jpeg))).rejects.toThrow(/PNG master/);
  });
});

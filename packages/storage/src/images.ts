// Processing an upload (§10 Processing every image, §13 Security summary): an upload is untrusted until it has been
// through here. Its type comes from its bytes, never its name or the type the browser sent; only JPG, PNG, WebP and SVG
// are read (§06; HEIC goes to Cloudflare Images, not here). The pixels are decoded once, turned upright, converted to
// sRGB, fitted in 4096 px and encoded again, so nothing else in the file survives: EXIF (location, camera), XMP, IPTC,
// text chunks, comments, or whatever a polyglot hides after the image. Every output is read back to check that. An SVG
// is only ever rasterised (to PNG); it is never stored or served as SVG.
//
// The set: the clean full-size file (stored at the asset's `original` key), the `1600` and `360` copies as WebP (the
// longest side at most that size, never enlarged), the sha256 of the stored file, a perceptual hash (dHash, 64 bits)
// for duplicates, and up to 5 dominant colours (§06: a palette of 3–5 swatches).
import { createHash } from 'node:crypto';
import type { WorkspaceCtx } from '@lzp/db';
import sharp, { type Metadata, type Sharp, type SharpOptions } from 'sharp';
import { assetKey, type AssetVariant } from './keys.ts';
import type { Storage } from './storage.ts';

export type ImageType = 'jpeg' | 'png' | 'webp' | 'svg';

/** Why an upload was refused: the message is safe to show to the person who sent it. */
export type RefusalReason = 'not-an-image' | 'unreadable' | 'too-many-pixels' | 'unsafe-svg';

export class ImageRefusedError extends Error {
  override readonly name = 'ImageRefusedError';
  readonly reason: RefusalReason;
  constructor(reason: RefusalReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** The stored size's longest side (§10, §06). */
export const MAX_SIDE = 4096;
/**
 * The most pixels a raster upload may claim in its header: 100 megapixels, twice a 48 MP phone photo. Checked before
 * decoding, so a small file that claims a huge picture (a pixel bomb) never gets its memory.
 */
export const MAX_INPUT_PIXELS = 100_000_000;
const FULL_QUALITY = 90;
const COPY_QUALITY = 80;
const MAX_COLOURS = 5;

export interface ImageFile {
  readonly data: Uint8Array;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly width: number;
  readonly height: number;
}

export interface ImageSet {
  /** What the upload was, from its bytes. */
  readonly type: ImageType;
  /** Each file under the asset key's variant it is stored at. */
  readonly files: Readonly<Record<AssetVariant, ImageFile>>;
  /** Of `files.original.data`, the file that is stored. */
  readonly sha256: string;
  /** 16 hex digits; near-identical pictures differ in few bits. */
  readonly perceptualHash: string;
  /** `#rrggbb`, most common first; transparent pixels left out. */
  readonly dominantColors: readonly string[];
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// An SVG's root: after the XML declaration, comments, a DOCTYPE and whitespace (`\s` takes a BOM too), `<svg`. Each
// alternative starts differently and can end in one place only (a comment at its first `-->`, a DOCTYPE's subset at
// its first `]`), and whitespace is matched one character at a time, so there is one way to read the prolog and
// nothing to backtrack into. It only ever sees the first 4 KB.
const SVG_ROOT =
  /^(?:\s|<\?xml[^>]*>|<!--(?:[^-]|-(?!->))*-->|<!DOCTYPE[^[>]*(?:\[[^\]]*\][^>]*)?>)*<svg[\s/>]/i;
const SVG_HEAD_BYTES = 4096;

/** The type the bytes say, or `null` for anything that isn't a JPG, PNG, WebP or SVG. */
function sniff(bytes: Buffer): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (SVG_ROOT.test(bytes.toString('utf8', 0, SVG_HEAD_BYTES))) return 'svg';
  return null;
}

const UNREADABLE = "This image couldn't be read. Please export it again as a JPG or PNG.";

/**
 * How sharp should open the upload. A raster's header is checked against `MAX_INPUT_PIXELS` first; an SVG has no
 * pixels of its own, so it is drawn at the density that makes its longest side `MAX_SIDE`, whatever size it claims.
 */
async function openOptions(bytes: Buffer, type: ImageType): Promise<SharpOptions> {
  let header: Metadata;
  try {
    // Header only, nothing decoded yet: the pixel check below is ours, with its own message.
    header = await sharp(bytes, { limitInputPixels: false }).metadata();
  } catch {
    throw new ImageRefusedError('unreadable', UNREADABLE);
  }
  if (header.format !== type) throw new ImageRefusedError('unreadable', UNREADABLE);
  const longest = Math.max(header.width, header.height);
  if (type === 'svg') {
    if (longest <= 0) throw new ImageRefusedError('unreadable', UNREADABLE);
    // sharp reads an SVG at 72 dpi by default, and takes 1 to 100000.
    return { density: Math.min(100_000, Math.max(1, (72 * MAX_SIDE) / longest)) };
  }
  if (header.width * header.height > MAX_INPUT_PIXELS) {
    throw new ImageRefusedError(
      'too-many-pixels',
      `This image is too large: at most ${String(MAX_INPUT_PIXELS / 1_000_000)} megapixels.`,
    );
  }
  return {};
}

/** Encodes for storage: the upload's own format at full size, PNG for an SVG, WebP for the copies. */
function encode(image: Sharp, format: 'jpeg' | 'png' | 'webp', quality: number): Sharp {
  if (format === 'jpeg') return image.jpeg({ quality });
  if (format === 'png') return image.png();
  return image.webp({ quality });
}

async function toFile(image: Sharp, format: 'jpeg' | 'png' | 'webp'): Promise<ImageFile> {
  const { data, info } = await image.toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8Array(data),
    contentType: `image/${format}`,
    width: info.width,
    height: info.height,
  };
}

/** Fits inside `side` × `side`, never enlarged, in sRGB and tagged with it. sharp keeps no other metadata. */
function fitted(image: Sharp, side: number): Sharp {
  return image
    .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .withIccProfile('srgb');
}

/** Re-reads a file that is about to be stored: anything but clean sRGB pixels is a bug, and nothing is stored. */
async function verify(variant: string, file: ImageFile): Promise<void> {
  const read = await sharp(file.data).metadata();
  const clean =
    `image/${read.format}` === file.contentType &&
    read.width === file.width &&
    read.height === file.height &&
    Math.max(read.width, read.height) <= MAX_SIDE &&
    read.space === 'srgb' &&
    read.icc !== undefined &&
    read.exif === undefined &&
    read.xmp === undefined &&
    read.iptc === undefined &&
    read.comments === undefined;
  if (!clean) throw new Error(`the processed ${variant} file is not clean`);
}

/** dHash: 9×8 grey pixels, one bit per pair of neighbours in a row (is the left one darker?). */
async function perceptualHash(file: Uint8Array): Promise<string> {
  const grey = await sharp(file)
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer();
  let hash = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = grey.readUInt8(y * 9 + x);
      const right = grey.readUInt8(y * 9 + x + 1);
      hash = (hash << 1n) | (left < right ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * The most common colours: on a 64 px sample, each opaque pixel goes into one of 512 boxes (3 bits per channel), and
 * the 5 fullest boxes give their average colour, fullest first (ties by box, so the answer is stable).
 */
async function dominantColors(file: Uint8Array): Promise<string[]> {
  const pixels = await sharp(file)
    .resize({ width: 64, height: 64, fit: 'inside', withoutEnlargement: true, kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const boxes = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels.readUInt8(i + 3) < 128) continue;
    const r = pixels.readUInt8(i);
    const g = pixels.readUInt8(i + 1);
    const b = pixels.readUInt8(i + 2);
    const id = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const box = boxes.get(id) ?? { count: 0, r: 0, g: 0, b: 0 };
    boxes.set(id, { count: box.count + 1, r: box.r + r, g: box.g + g, b: box.b + b });
  }
  const hex = (sum: number, count: number): string =>
    Math.round(sum / count)
      .toString(16)
      .padStart(2, '0');
  return [...boxes.entries()]
    .sort(([idA, a], [idB, b]) => b.count - a.count || idA - idB)
    .slice(0, MAX_COLOURS)
    .map(([, box]) => `#${hex(box.r, box.count)}${hex(box.g, box.count)}${hex(box.b, box.count)}`);
}

/**
 * Turns an upload into the set that is stored, or refuses it with an `ImageRefusedError` (a message safe to show).
 * `bytes` is the whole upload, already capped in size by `Storage.get`.
 */
export async function processImage(bytes: Uint8Array): Promise<ImageSet> {
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = sniff(input);
  if (type === null) {
    throw new ImageRefusedError('not-an-image', "That file isn't a JPG, PNG, WebP or SVG image.");
  }
  // A DOCTYPE is how entity expansion and outside files get into XML; an SVG logo never needs one.
  if (type === 'svg' && /<!DOCTYPE|<!ENTITY/i.test(input.toString('utf8'))) {
    throw new ImageRefusedError(
      'unsafe-svg',
      'This SVG has parts that are not allowed. Please send a PNG.',
    );
  }
  const options = await openOptions(input, type);
  const format = type === 'svg' ? 'png' : type;
  let original: ImageFile;
  try {
    const opened = sharp(input, {
      ...options,
      limitInputPixels: MAX_INPUT_PIXELS, // the second wall, at decode time
      failOn: 'warning',
      autoOrient: true,
    });
    original = await toFile(encode(fitted(opened, MAX_SIDE), format, FULL_QUALITY), format);
  } catch {
    throw new ImageRefusedError('unreadable', UNREADABLE);
  }
  // The copies come from the clean file, which is upright and sRGB already.
  const copy = (side: number): Promise<ImageFile> =>
    toFile(encode(fitted(sharp(original.data), side), 'webp', COPY_QUALITY), 'webp');
  const [large, small] = await Promise.all([copy(1600), copy(360)]);
  const files = { original, '1600': large, '360': small };
  await Promise.all(Object.entries(files).map(([variant, file]) => verify(variant, file)));
  return {
    type,
    files,
    sha256: createHash('sha256').update(original.data).digest('hex'),
    perceptualHash: await perceptualHash(original.data),
    dominantColors: await dominantColors(original.data),
  };
}

// The copies first and the original last: until the clean original replaces the upload, a retry after a failure
// reads the upload itself again, not a file already re-encoded once.
const SAVE_ORDER = ['1600', '360', 'original'] as const satisfies readonly AssetVariant[];

/** Writes each file of `set` under the key `assetKey` gives its variant, and only there. */
export async function saveImageSet(
  storage: Pick<Storage, 'put'>,
  ctx: WorkspaceCtx,
  asset: { brandId: string; assetId: string },
  set: ImageSet,
): Promise<void> {
  for (const variant of SAVE_ORDER) {
    const file = set.files[variant];
    await storage.put(ctx, assetKey(ctx, { ...asset, variant }), file.data, file.contentType);
  }
}

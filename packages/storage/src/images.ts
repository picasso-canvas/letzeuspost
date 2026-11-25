// Processing an upload (§10 Processing every image, §13 Security summary): an upload is untrusted until it has been
// through here. Its type comes from its bytes, never its name or the type the browser sent; only JPG, PNG, WebP and SVG
// are read (§06; HEIC goes to Cloudflare Images, not here). The pixels are decoded once, turned upright, converted to
// sRGB, fitted in 4096 px and encoded again, so nothing else in the file survives: EXIF (location, camera), XMP, IPTC,
// text chunks, comments, or whatever a polyglot hides after the image. Every output is read back to check that. An SVG
// is only ever rasterised (to PNG); it is never stored or served as SVG.
//
// An SVG is a program as much as a picture, so it gets two more walls. First, it may point only inside itself. A link
// to a `data:`, `file:` or `http:` address is refused, and so is anything that loads one: an image inside it can be a
// pixel bomb or an XML file of its own, and a link reaches the worker's disk or network. Second, it is drawn in a
// process of its own (`rasterise-svg.ts`) that is killed at the time limit. Every other step has sharp's time limit too.
//
// The set: the clean full-size file (stored at the asset's `original` key), the `1600` and `360` copies as WebP (the
// longest side at most that size, never enlarged), the sha256 of the stored file, a perceptual hash (dHash, 64 bits)
// for duplicates, and up to 5 dominant colours (§06: a palette of 3–5 swatches).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { WorkspaceCtx } from '@lzp/db';
import sharp, { type Metadata, type Sharp } from 'sharp';
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
/** How long drawing an SVG, or each step on a picture, may take before the upload is refused (§10: 5–15 s a photo). */
export const TIME_LIMIT_SECONDS = 15;
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
const UNSAFE_SVG = 'This SVG has parts that are not allowed. Please send a PNG.';

// What an SVG may not hold. Anything here is refused, wherever it appears, even in a comment: a logo needs none of it.
// These run on the worker's own thread, on files of up to 20 MB, so no rule may have two quantifiers that can match
// the same characters: each has one way to read a run, and nothing to backtrack into.
const SVG_REFUSED: readonly RegExp[] = [
  // Entity expansion and outside files come in through a DOCTYPE.
  /<!DOCTYPE|<!ENTITY/i,
  // Another encoding than UTF-8 (UTF-7, say) would hide from these rules what the parser then reads.
  /encoding\s*=(?!\s*["']utf-8["'])/i,
  // Elements that load or embed another document, with any namespace prefix.
  /<(?:[^\s<>:]+:)?(?:image|foreignObject)[\s/>]/i,
  // A link (`href`, `xlink:href`, an `xml-stylesheet`'s) to anything but an `#id` in this file.
  /href\s*=(?!\s*["']#)/i,
  // A CSS `url()` to anything but an `#id`; a stylesheet import of any kind. The whitespace inside quotes is matched
  // only after a quote, so it can't take the characters the whitespace before them took.
  /url\((?!\s*(?:["']\s*)?#)/i,
  /@import/i,
  // A CSS escape can write `url(` or `@import` without those letters (`u\72 l(`).
  /\\/,
];
// XML reads `&#117;` as `u`, so the rules look at the text both before and after these are read. With no DOCTYPE, only
// the five predefined entities exist.
const REFERENCE = /&#x([0-9a-f]+);|&#([0-9]+);|&(amp|lt|gt|quot|apos);/gi;
const PREDEFINED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function readReference(_: string, hex?: string, decimal?: string, name?: string): string {
  if (name !== undefined) return PREDEFINED[name.toLowerCase()] ?? '';
  const code = hex === undefined ? Number(decimal) : Number.parseInt(hex, 16);
  // A character XML can't hold makes the file unreadable to the parser; for these rules it is no letter at all.
  return code <= 0x10ffff ? String.fromCodePoint(code) : '�';
}

/** Refuses an SVG that isn't plain UTF-8, or that holds anything `SVG_REFUSED` lists. */
function checkSvg(svg: Buffer): void {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(svg);
  } catch {
    throw new ImageRefusedError('unsafe-svg', UNSAFE_SVG);
  }
  const read = text.replace(REFERENCE, readReference);
  if (SVG_REFUSED.some((rule) => rule.test(text) || rule.test(read))) {
    throw new ImageRefusedError('unsafe-svg', UNSAFE_SVG);
  }
}

const RASTERISER = fileURLToPath(new URL('./rasterise-svg.ts', import.meta.url));
// A PNG of `MAX_SIDE` × `MAX_SIDE` pixels, 4 bytes each, with room for the format's own bytes.
const MAX_RASTER_BYTES = MAX_SIDE * MAX_SIDE * 4 + 1_000_000;

/**
 * Draws a checked SVG as a PNG whose longest side is `MAX_SIDE`, whatever size it claims. This runs in a process that
 * is killed after `seconds`, gets no environment (so no secrets), and may write at most `MAX_RASTER_BYTES`.
 */
function rasteriseSvg(svg: Buffer, seconds: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [RASTERISER, String(MAX_SIDE), String(MAX_INPUT_PIXELS)],
      {
        encoding: 'buffer',
        env: {},
        timeout: seconds * 1000,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_RASTER_BYTES,
      },
      (error, png) => {
        if (error === null) resolve(png);
        else reject(new ImageRefusedError('unreadable', UNREADABLE));
      },
    );
    // A process that fails before it has read the whole SVG closes its stdin; how it ended is what counts.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(svg);
  });
}

/** Checks a picture's header against `MAX_INPUT_PIXELS` before anything is decoded. */
async function checkHeader(bytes: Buffer, format: 'jpeg' | 'png' | 'webp'): Promise<void> {
  let header: Metadata;
  try {
    // Header only, nothing decoded yet: the pixel check below is ours, with its own message.
    header = await sharp(bytes, { limitInputPixels: false }).metadata();
  } catch {
    throw new ImageRefusedError('unreadable', UNREADABLE);
  }
  if (header.format !== format) throw new ImageRefusedError('unreadable', UNREADABLE);
  if (header.width * header.height > MAX_INPUT_PIXELS) {
    throw new ImageRefusedError(
      'too-many-pixels',
      `This image is too large: at most ${String(MAX_INPUT_PIXELS / 1_000_000)} megapixels.`,
    );
  }
}

/** Opens a picture to decode: refused past `MAX_INPUT_PIXELS` or a warning, stopped after `seconds`, turned upright. */
function open(bytes: Uint8Array, seconds: number): Sharp {
  return sharp(bytes, {
    limitInputPixels: MAX_INPUT_PIXELS, // the second wall, at decode time
    failOn: 'warning',
    autoOrient: true,
  }).timeout({ seconds });
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
async function perceptualHash(file: Uint8Array, seconds: number): Promise<string> {
  const grey = await open(file, seconds)
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
async function dominantColors(file: Uint8Array, seconds: number): Promise<string[]> {
  const pixels = await open(file, seconds)
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
 * `bytes` is the whole upload, already capped in size by `Storage.get`. `seconds` (a whole number, 1 to 3600) bounds
 * drawing an SVG, and each step on the picture.
 */
export async function processImage(
  bytes: Uint8Array,
  { seconds = TIME_LIMIT_SECONDS }: { seconds?: number } = {},
): Promise<ImageSet> {
  // sharp takes 0 as "no limit", so 0 is refused here.
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
    throw new RangeError('seconds must be a whole number from 1 to 3600');
  }
  const upload = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = sniff(upload);
  if (type === null) {
    throw new ImageRefusedError('not-an-image', "That file isn't a JPG, PNG, WebP or SVG image.");
  }
  // From here on an SVG is the PNG it was drawn as, read like any other picture.
  const format = type === 'svg' ? 'png' : type;
  let picture = upload;
  if (type === 'svg') {
    checkSvg(upload);
    picture = await rasteriseSvg(upload, seconds);
  }
  await checkHeader(picture, format);
  const drawn = await draw(picture, format, seconds).catch(() => {
    throw new ImageRefusedError('unreadable', UNREADABLE);
  });
  await Promise.all(Object.entries(drawn.files).map(([variant, file]) => verify(variant, file)));
  return {
    type,
    ...drawn,
    sha256: createHash('sha256').update(drawn.files.original.data).digest('hex'),
  };
}

/** The clean file, its copies and its fingerprints; every step stops after `seconds`. */
async function draw(
  picture: Buffer,
  format: 'jpeg' | 'png' | 'webp',
  seconds: number,
): Promise<Pick<ImageSet, 'files' | 'perceptualHash' | 'dominantColors'>> {
  const original = await toFile(
    encode(fitted(open(picture, seconds), MAX_SIDE), format, FULL_QUALITY),
    format,
  );
  // The copies come from the clean file, which is upright and sRGB already.
  const copy = (side: number): Promise<ImageFile> =>
    toFile(encode(fitted(open(original.data, seconds), side), 'webp', COPY_QUALITY), 'webp');
  const [large, small, hash, colours] = await Promise.all([
    copy(1600),
    copy(360),
    perceptualHash(original.data, seconds),
    dominantColors(original.data, seconds),
  ]);
  return {
    files: { original, '1600': large, '360': small },
    perceptualHash: hash,
    dominantColors: colours,
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

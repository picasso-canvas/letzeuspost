import sharp from 'sharp';
import { RenderFailure } from '../browser/limits.ts';

// The image outputs (§08 Outputs), every one made from the PNG master (Chrome's lossless screenshot at 1×, in sRGB):
// the JPEG that is exported by default, the PNG on request, and the 360 px WebP thumbnail for the app's cards. Each is
// tagged sRGB and carries nothing else: sharp drops a source's EXIF, XMP, IPTC and text chunks unless asked to keep
// them, and only the colour profile is asked for here.

/** The JPEG qualities, tried in order until the file is under `MAX_JPEG_BYTES` (§08). */
export const JPEG_QUALITIES = [90, 85, 80] as const;

export type JpegQuality = (typeof JPEG_QUALITIES)[number];

/** 5 MB, counted in decimal megabytes so the file is under the limit whichever way a network counts. */
export const MAX_JPEG_BYTES = 5 * 1000 * 1000;

/** The thumbnail's width for the app's cards (§08); its height keeps the slide's proportions. */
export const THUMBNAIL_WIDTH = 360;
const THUMBNAIL_QUALITY = 80;

/** The master as sharp reads it, once it is known to be a PNG (anything else is a bug in the caller). */
async function fromMaster(master: Uint8Array): Promise<sharp.Sharp> {
  const image = sharp(master);
  const { format } = await image.metadata();
  if (format !== 'png')
    throw new Error('The output is made from the PNG master; this is not a PNG');
  // Converted to sRGB (a master without a profile is taken as sRGB, which Chrome drew it in) and tagged with it.
  return image.withIccProfile('srgb');
}

/**
 * The JPEG export (§08): quality 90, no chroma subsampling (coloured text stays crisp), progressive, the sRGB profile
 * embedded, no other metadata. Over 5 MB, the quality steps to 85, then 80. Returns the file and the quality it took;
 * fails with a reason a person can read when even 80 is over, rather than export a file a network would refuse.
 */
export async function toJpeg(
  master: Uint8Array,
): Promise<{ data: Uint8Array; quality: JpegQuality }> {
  const image = await fromMaster(master);
  for (const quality of JPEG_QUALITIES) {
    const data = await image
      .clone()
      .jpeg({ quality, chromaSubsampling: '4:4:4', progressive: true })
      .toBuffer();
    if (data.byteLength < MAX_JPEG_BYTES) return { data: new Uint8Array(data), quality };
  }
  throw new RenderFailure('The slide is over 5 MB as a JPEG, even at quality 80');
}

/** The PNG on request (§08): the master's pixels, unchanged, with its sRGB profile and no other metadata. */
export async function toPng(master: Uint8Array): Promise<Uint8Array> {
  const image = await fromMaster(master);
  return new Uint8Array(await image.png({ palette: false }).toBuffer());
}

/** The thumbnail for the app's cards (§08): 360 px wide, WebP, sRGB, no other metadata. */
export async function toThumbnail(master: Uint8Array): Promise<Uint8Array> {
  const image = await fromMaster(master);
  return new Uint8Array(
    await image.resize({ width: THUMBNAIL_WIDTH }).webp({ quality: THUMBNAIL_QUALITY }).toBuffer(),
  );
}

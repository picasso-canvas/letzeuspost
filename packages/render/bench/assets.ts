import sharp from 'sharp';
import type { RenderAsset } from '../src/browser/index.ts';

// The sample batch's images, made here so the benchmark needs no files: a 1600 px photo (the size the PDF uses, §08 Outputs)
// and a mascot, so the renderer has real pictures to decode and draw, and a one-pixel logo.

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Soft noise, so the encoder has something to do: a flat colour would decode in no time. */
const noise = (width: number, height: number) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  }).blur(3);

export async function sampleAssets(): Promise<RenderAsset[]> {
  const [photo, mascot] = await Promise.all([
    noise(1600, 1200).jpeg({ quality: 80 }).toBuffer(),
    noise(600, 600).png().toBuffer(),
  ]);
  return [
    { kind: 'image', key: 'logo_light_1', contentType: 'image/png', data: PIXEL },
    { kind: 'image', key: 'photo_sample_1', contentType: 'image/jpeg', data: photo },
    { kind: 'image', key: 'mascot_1', contentType: 'image/png', data: mascot },
  ];
}

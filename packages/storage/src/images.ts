import type { WorkspaceCtx } from '@lzp/db';
import type { AssetVariant } from './keys.ts';
import type { Storage } from './storage.ts';

export type ImageType = 'jpeg' | 'png' | 'webp' | 'svg';
export type RefusalReason = 'not-an-image' | 'unreadable' | 'too-many-pixels' | 'unsafe-svg';

export class ImageRefusedError extends Error {
  override readonly name = 'ImageRefusedError';
  constructor(
    readonly reason: RefusalReason,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_INPUT_PIXELS = 100_000_000;

export interface ImageFile {
  readonly data: Uint8Array;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly width: number;
  readonly height: number;
}

export interface ImageSet {
  readonly type: ImageType;
  readonly files: Readonly<Record<AssetVariant, ImageFile>>;
  readonly sha256: string;
  readonly perceptualHash: string;
  readonly dominantColors: readonly string[];
}

export function processImage(_bytes: Uint8Array): Promise<ImageSet> {
  return Promise.reject(new Error('not built yet'));
}

export function saveImageSet(
  _storage: Pick<Storage, 'put'>,
  _ctx: WorkspaceCtx,
  _asset: { brandId: string; assetId: string },
  _set: ImageSet,
): Promise<void> {
  return Promise.reject(new Error('not built yet'));
}

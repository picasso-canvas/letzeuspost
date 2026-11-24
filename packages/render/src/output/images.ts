export const JPEG_QUALITIES = [] as const;
export const MAX_JPEG_BYTES = 0;

export function toJpeg(_master: Uint8Array): Promise<{ data: Uint8Array; quality: number }> {
  return Promise.reject(new Error('not built'));
}

export function toPng(_master: Uint8Array): Promise<Uint8Array> {
  return Promise.reject(new Error('not built'));
}

export function toThumbnail(_master: Uint8Array): Promise<Uint8Array> {
  return Promise.reject(new Error('not built'));
}

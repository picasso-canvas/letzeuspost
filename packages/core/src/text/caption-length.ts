export const NETWORKS = [
  'instagram',
  'facebook',
  'linkedin',
  'x',
  'threads',
  'tiktok',
  'pinterest',
] as const;

export type Network = (typeof NETWORKS)[number];

/** Stub: filled in after the tests. */
export function captionLength(_network: Network, _text: string): number {
  return -1;
}

/** Stub: filled in after the tests. */
export function fitsCaption(_network: Network, _text: string, _limit: number): boolean {
  return false;
}

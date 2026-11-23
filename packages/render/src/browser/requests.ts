import type { AssetKind } from '../page/assets.ts';

export const PAGE_ORIGIN = 'https://render.lzp.invalid';
export const PAGE_URL = `${PAGE_ORIGIN}/`;

export type RenderAsset = {
  kind: AssetKind;
  key: string;
  contentType: string;
  data: Uint8Array;
};

export type AssetIndex = ReadonlyMap<string, RenderAsset>;

export function loggedUrl(_url: string): string {
  throw new Error('not built yet');
}

export function assetIndex(_assets: readonly RenderAsset[]): AssetIndex {
  throw new Error('not built yet');
}

export function findAsset(_index: AssetIndex, _url: string): RenderAsset | undefined {
  throw new Error('not built yet');
}

export function servedHtml(_html: string): string {
  throw new Error('not built yet');
}

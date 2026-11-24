import type { Post } from '@lzp/core';
import type { RenderKit } from '../kit.ts';
import type { SizeName } from '../sizes.ts';

export type OutputFormat = 'png' | 'jpeg' | 'webp' | 'pdf';

type Common = {
  rendererVersion: number;
  lookVersion: number;
  kit: RenderKit;
  post: Post;
  assets: readonly { key: string; sha256: string }[];
  size: SizeName;
};

export type RenderKeyInput = Common &
  ({ format: 'png' | 'jpeg' | 'webp'; slide: number } | { format: 'pdf'; title: string });

export function renderKey(_input: RenderKeyInput): string {
  return '';
}

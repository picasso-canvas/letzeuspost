import type { Post, SizeName, Slide } from '@lzp/core';
import type { RenderKit } from '../src/kit.ts';

export type BatchJob = {
  postId: string;
  post: Post;
  slide: Slide;
  size: SizeName;
  kit: RenderKit;
};

export function sampleBatch(): BatchJob[] {
  return [];
}

export function takeRenders(_batch: readonly BatchJob[], _renders: number): BatchJob[] {
  return [];
}

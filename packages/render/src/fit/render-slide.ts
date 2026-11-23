import type { Post, Slide, SizeName } from '@lzp/core';
import type { RenderKit } from '../kit.ts';
import type { RenderAsset, RenderPageInput, RenderResult } from '../browser/index.ts';
import type { FitReport } from './report.ts';

export type FitRenderer = {
  renderPage: (input: RenderPageInput) => Promise<RenderResult & { fit?: unknown }>;
};

export function renderSlide(
  renderer: FitRenderer,
  input: {
    post: Post;
    slide: Slide;
    size: SizeName;
    kit: RenderKit;
    assets: readonly RenderAsset[];
    jobId: string;
    deadline?: number;
  },
): Promise<{ png: Uint8Array; report: FitReport }> {
  void [renderer, input];
  return Promise.reject(new Error('not built yet'));
}

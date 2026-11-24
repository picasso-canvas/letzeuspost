import type { Post } from '@lzp/core';
import type { FitReport } from '../fit/report.ts';
import type { RenderKit } from '../kit.ts';
import type { SizeName } from '../sizes.ts';

export type DocumentInput = {
  post: Post;
  size: SizeName;
  kit: RenderKit;
  reports: readonly FitReport[];
  title: string;
};

export function buildDocument(_input: DocumentInput): string {
  return '';
}

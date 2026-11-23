import type { Post, SizeName } from '@lzp/core';
import { z } from 'zod';

export const FitReportSchema = z.unknown();
export const PageFitSchema = z.unknown();
export type FitReport = { size: SizeName; slide: number; k: number; status: string; fields: unknown[] };
export type PageFit = {
  k: number;
  fits: boolean;
  fields: { name: string; lines: number; needed: number; available: number; overflowPx: number }[];
};

export function buildFitReport(post: Post, index: number, size: SizeName, page: PageFit): never {
  void [post, index, size, page];
  throw new Error('not built yet');
}

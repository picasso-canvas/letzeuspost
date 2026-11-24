import type { LayoutName, LookName, Post, SizeName } from '../../packages/core/src/index.ts';
import type { RenderAsset } from '../../packages/render/src/browser/index.ts';
import type { ContrastResult } from '../../packages/render/src/contrast/apply.ts';
import type { RenderKit } from '../../packages/render/src/kit.ts';
import type { BrandId } from './brands.ts';

export const LANGS = ['en', 'bn'] as const;
export type Lang = (typeof LANGS)[number];
export const LAUNCH_LAYOUTS: readonly LayoutName[] = [];
export const LAUNCH_LOOKS: readonly LookName[] = [];

export type HardKind = 'longest' | 'conjuncts' | 'missing-image' | 'no-bangla-font' | 'contrast';

export type GoldenCase = {
  id: string;
  layout: LayoutName;
  size: SizeName;
  look: LookName;
  lang: Lang;
  brand: BrandId;
  hard?: HardKind;
};

export type CaseInput = {
  post: Post;
  kit: RenderKit;
  contrast: ContrastResult;
  assets: RenderAsset[];
  expected: { fontFallback: boolean; blocked: string[]; contrastShaded: boolean };
};

export function casesFor(layouts: readonly LayoutName[], looks: readonly LookName[]): GoldenCase[] {
  return layouts.length + looks.length < 0 ? [] : [];
}

export const LAUNCH_CASES: GoldenCase[] = [];
export const HARD_CASES: GoldenCase[] = [];
export const GOLDEN_CASES: GoldenCase[] = [];

export function caseInput(golden: GoldenCase): CaseInput {
  throw new Error(`not yet: ${golden.id}`);
}

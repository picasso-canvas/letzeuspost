import type { RenderKit } from '../../packages/render/src/kit.ts';

export const BRAND_IDS = ['kathgolap', 'tidewell', 'chaka'] as const;
export type BrandId = (typeof BRAND_IDS)[number];

export type SampleBrand = { name: { en: string; bn: string }; kit: RenderKit };

export const SAMPLE_BRANDS: Record<BrandId, SampleBrand> = {} as Record<BrandId, SampleBrand>;

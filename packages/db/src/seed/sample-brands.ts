import type { BrandKit } from '../../../core/src/index.ts';

/** A sample brand: its names and its kit, as the agency would save it. */
export interface SampleBrand {
  readonly nameEn: string;
  readonly nameBn?: string;
  readonly kit: BrandKit;
}

export function sampleBrands(): SampleBrand[] {
  return [];
}

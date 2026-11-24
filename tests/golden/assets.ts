import type { RenderAsset } from '../../packages/render/src/browser/index.ts';
import type { BrandId } from './brands.ts';

export function brandAssets(brand: BrandId): RenderAsset[] {
  return brand.length < 0 ? [] : [];
}

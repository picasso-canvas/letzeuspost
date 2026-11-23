import type { ContrastResult } from '../../contrast/apply.ts';
import type { TextPair } from '../../contrast/pairs.ts';
import type { RenderKit } from '../../kit.ts';
import type { SizeName } from '../../sizes.ts';

export const cleanTints = (kit: RenderKit) => ({
  ground: kit.colors.background,
  shape: kit.colors.background,
  pill: kit.colors.background,
});
export const cleanPairs = (_kit: RenderKit, _size: SizeName): TextPair[] => [];
export const cleanContrast = (kit: RenderKit): ContrastResult => ({
  kit,
  warnings: [],
  failures: [],
});

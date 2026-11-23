import type { LookName } from '@lzp/core';
import type { RenderKit } from '../kit.ts';
import type { PairResult, TextPair } from './pairs.ts';

// Auto-shading of a brand kit that fails the contrast check (§07 Contrast, §08).

/** One colour of the kit that was shaded: which one, from what, to what, and the pairs that made it fail. */
export type ContrastWarning = {
  /** `ink`, `accent`, `primary`, `background` or `extras[0]`. */
  colour: string;
  look: LookName;
  from: string;
  to: string;
  pairs: string[];
};

export type ContrastResult = {
  /** The kit to render with: the same object when nothing failed. */
  kit: RenderKit;
  warnings: ContrastWarning[];
  /** Pairs still under their limit: no colour of the kit could be shaded to fix them. */
  failures: PairResult[];
};

export function applyContrast(
  _kit: RenderKit,
  _look: LookName,
  _pairs?: readonly TextPair[],
): ContrastResult {
  throw new Error('not implemented');
}

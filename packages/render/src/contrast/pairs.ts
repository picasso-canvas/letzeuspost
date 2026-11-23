import type { LookName, SizeName, Slide } from '@lzp/core';
import type { RenderKit } from '../kit.ts';

// The text pairs of a layout and the check on them (§07 Contrast, §08 Looks in the renderer).

/** A colour of the brand kit: a role, or the n-th of `extras`. */
export type KitColour = 'primary' | 'accent' | 'background' | 'ink' | { extra: number };
/** Text colour: the kit's, or a fixed one the look brings itself (`{ hex: '#ffffff' }`). */
export type TextColour = KitColour | { hex: string };
/** What the text sits on: a colour, or a photo (always with its scrim, `scrim.ts`). */
export type Backdrop = TextColour | { photo: true };

export type LayoutPair = {
  /** What the pair is, for the editor: `headline on background`. */
  name: string;
  text: TextColour;
  on: Backdrop;
  /** The real font size in pixels at the page's own width. */
  px: number;
  /** A headline of 48 px or more (at 1080 width) needs 3:1, not 4.5:1. */
  headline?: boolean;
};

/** A `LayoutPair` with the width of the page it is drawn on (default 1080). */
export type TextPair = LayoutPair & { width?: number };

export type PairResult = {
  name: string;
  look: LookName;
  /** The text colour as `#rrggbb`. */
  text: string;
  /** The backdrop it was judged on: for a photo, the worse of the brightest and darkest photo under its scrim. */
  on: string;
  photo: boolean;
  ratio: number;
  limit: number;
  passes: boolean;
};

export type PairContext = { kit: RenderKit; look: LookName; size: SizeName };
export type PairsFn = (context: PairContext) => LayoutPair[];

export function registerPairs(_layout: Slide['layout'], _fn: PairsFn): void {
  throw new Error('not implemented');
}

export function pairsFor(
  _layout: Slide['layout'],
  _kit: RenderKit,
  _look: LookName,
  _size: SizeName,
): TextPair[] {
  throw new Error('not implemented');
}

export function resolveColour(_kit: RenderKit, _colour: TextColour): string {
  throw new Error('not implemented');
}

export function checkPairs(
  _kit: RenderKit,
  _look: LookName,
  _pairs: readonly TextPair[],
): PairResult[] {
  throw new Error('not implemented');
}

import type { LookName, SizeName, Slide } from '@lzp/core';
import type { RenderKit } from '../kit.ts';
import { SIZES } from '../sizes.ts';
import { contrastRatio, toHex, parseHex } from './colour.ts';
import { photoBackdrops } from './scrim.ts';

// The text pairs of a layout and the check on them (§07 Contrast, §08 Looks in the renderer). The check runs on the
// tokens, before rendering, and never looks at pixels. How a layout declares its pairs: `README.md` in this folder.

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

/** 4.5:1 for text (WCAG AA); 3:1 for a headline of `HEADLINE_PX` or more at `REFERENCE_WIDTH` (§07). */
export const TEXT_LIMIT = 4.5;
export const HEADLINE_LIMIT = 3;
export const HEADLINE_PX = 48;
export const REFERENCE_WIDTH = 1080;

export type PairContext = { kit: RenderKit; look: LookName; size: SizeName };
export type PairsFn = (context: PairContext) => LayoutPair[];

const registry = new Map<Slide['layout'], PairsFn>();

/** A layout declares the text pairs it draws, for the kit, look and size it is asked about (README.md). */
export function registerPairs(layout: Slide['layout'], fn: PairsFn): void {
  if (registry.has(layout)) throw new Error(`The "${layout}" layout already registered its pairs`);
  registry.set(layout, fn);
}

/** The layouts that have declared their pairs. */
export const registeredLayouts = (): Slide['layout'][] => [...registry.keys()];

/** What a layout declared, for one kit, look and size, with the width of that size. Throws for a layout that declared nothing. */
export function pairsFor(
  layout: Slide['layout'],
  kit: RenderKit,
  look: LookName,
  size: SizeName,
): TextPair[] {
  const fn = registry.get(layout);
  if (fn === undefined) throw new Error(`The "${layout}" layout hasn't declared its text pairs`);
  const width = SIZES[size].width;
  return fn({ kit, look, size }).map((pair) => ({
    ...pair,
    name: `${layout}: ${pair.name}`,
    width,
  }));
}

/** A colour of the kit (or a fixed one) as lower-case `#rrggbb`. */
export function resolveColour(kit: RenderKit, colour: TextColour): string {
  if (typeof colour === 'string') return kit.colors[colour];
  if ('hex' in colour) return toHex(parseHex(colour.hex));
  const extra = kit.colors.extras[colour.extra];
  if (extra === undefined) throw new Error(`The kit has no extra colour number ${colour.extra}`);
  return extra;
}

/** The limit for a pair: 3:1 for a headline of 48 px or more at 1080 width, 4.5:1 for everything else. */
function limitOf(pair: TextPair): number {
  const at1080 = (pair.px * REFERENCE_WIDTH) / (pair.width ?? REFERENCE_WIDTH);
  return pair.headline === true && at1080 >= HEADLINE_PX ? HEADLINE_LIMIT : TEXT_LIMIT;
}

const isPhoto = (on: Backdrop): on is { photo: true } => typeof on === 'object' && 'photo' in on;

/** Every backdrop a pair has to hold on: one colour, or the brightest and the darkest photo under the scrim. */
export function backdropsOf(kit: RenderKit, pair: TextPair): string[] {
  const text = resolveColour(kit, pair.text);
  return isPhoto(pair.on) ? photoBackdrops(text) : [resolveColour(kit, pair.on)];
}

/**
 * Checks each pair on the kit's tokens: the ratio, the limit it must reach and whether it does. A pair on a photo is
 * judged behind its scrim, at the worse of the brightest and the darkest photo.
 */
export function checkPairs(
  kit: RenderKit,
  look: LookName,
  pairs: readonly TextPair[],
): PairResult[] {
  return pairs.map((pair) => {
    const text = resolveColour(kit, pair.text);
    const limit = limitOf(pair);
    const worst = backdropsOf(kit, pair)
      .map((on) => ({ on, ratio: contrastRatio(text, on) }))
      .sort((a, b) => a.ratio - b.ratio)[0];
    if (worst === undefined) throw new Error('A pair needs a backdrop');
    return {
      name: pair.name,
      look,
      text,
      on: worst.on,
      photo: isPhoto(pair.on),
      ratio: worst.ratio,
      limit,
      passes: worst.ratio >= limit,
    };
  });
}

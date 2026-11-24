import type { LayoutPair } from '../contrast/pairs.ts';
import { K_MIN } from '../fit/report.ts';
import { sizeCss } from '../page/base-css.ts';
import { SIZES, SMALL_PRINT_PX, type SizeName } from '../sizes.ts';

// The text a layout draws, as the contrast check wants it (§07 Contrast, `contrast/README.md`): each text colour on the
// background it sits on, at its real size, which is the smallest the fit check can set it (`K_MIN`; the body never
// under its floor, small print a fixed 28 px). The layouts here put their text on the page's background, never over a
// photo (the image has a box of its own), so no pair is declared on a photo and none needs the scrim.

/** A size's type scale at `--k: 1`, read from the base CSS itself, so the pairs can't drift from the page. */
function typeScale(size: SizeName): { title: number; body: number; kicker: number } {
  const css = sizeCss(size);
  const px = (name: string): number => {
    const value = new RegExp(`--${name}: ([\\d.]+)px;`).exec(css)?.[1];
    if (value === undefined) throw new Error(`The base CSS has no --${name} for ${size}`);
    return Number(value);
  };
  return { title: px('title-size'), body: px('body-size'), kicker: px('kicker-size') };
}

/** What a layout draws, and so which pairs it declares. */
export type PairParts = {
  /** A kicker above the title (`cover`). */
  kicker?: true;
  /** A body paragraph under the title. */
  body?: true;
  /** A line of 28 px small print: a sticker, a step label. */
  smallPrint?: true;
  /** A call to action, drawn as a highlight at the body's size. */
  cta?: true;
};

/**
 * The pairs of a layout: the title and its highlight (the headline), then whichever of kicker, body, small print and
 * call to action it has. Highlights are in the primary (an underline or colour) or in ink on a pill, and the pill
 * belongs to the look, so the look's own pairs cover it; the check here is on the kit's background.
 */
export function layoutPairs(parts: PairParts, size: SizeName): LayoutPair[] {
  const scale = typeScale(size);
  const title = scale.title * K_MIN;
  const body = Math.max(SIZES[size].bodyFloor, scale.body * K_MIN);
  return [
    { name: 'title', text: 'ink', on: 'background', px: title, headline: true },
    { name: 'title highlight', text: 'primary', on: 'background', px: title, headline: true },
    ...(parts.kicker === true
      ? [{ name: 'kicker', text: 'primary', on: 'background', px: scale.kicker * K_MIN } as const]
      : []),
    ...(parts.body === true
      ? [
          { name: 'body', text: 'ink', on: 'background', px: body } as const,
          { name: 'body highlight', text: 'primary', on: 'background', px: body } as const,
        ]
      : []),
    ...(parts.cta === true
      ? [{ name: 'call to action', text: 'primary', on: 'background', px: body } as const]
      : []),
    ...(parts.smallPrint === true
      ? [{ name: 'small print', text: 'ink', on: 'background', px: SMALL_PRINT_PX } as const]
      : []),
  ];
}

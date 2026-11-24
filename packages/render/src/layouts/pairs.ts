import type { LayoutPair } from '../contrast/pairs.ts';
import { K_MIN } from '../fit/report.ts';
import {
  ITEM_BODY_SHARE,
  OFFER_PRICE_SHARE,
  QUESTION_TITLE_SHARE,
  QUOTE_TITLE_SHARE,
  STAT_LABEL_SHARE,
  STAT_NUMBER_SHARE,
  sizeCss,
} from '../page/base-css.ts';
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
  /**
   * What leads the slide: its title (the default), a quote set at `QUOTE_TITLE_SHARE` of the title (`quote`), a number
   * set at `STAT_NUMBER_SHARE` of it, in the primary (`stat`), or a question at `QUESTION_TITLE_SHARE` (`question`).
   */
  lead?: 'quote' | 'number' | 'question';
  /** The stat's label under the number, a step above body text. */
  label?: true;
  /** A badge above the title, in the primary: 28 px small print (`offer`). */
  badge?: true;
  /** A price under the title, in the primary, at `OFFER_PRICE_SHARE` of the title (`offer`). */
  price?: true;
  /** The offer's details, a body paragraph that can carry a highlight. */
  details?: true;
  /** A question's options: a letter in the primary and the text in ink, set like list items; and the letter on a picture. */
  options?: true;
  /** A person's name at the body's size, in the heading weight (`quote`). */
  person?: true;
};

/**
 * The pairs of a layout: the title and its highlight (the headline), then whichever of kicker, body, small print and
 * call to action it has. Highlights are in the primary (an underline or colour) or in ink on a pill, and the pill
 * belongs to the look, so the look's own pairs cover it; the check here is on the kit's background.
 */
export function layoutPairs(parts: PairParts, size: SizeName): LayoutPair[] {
  const scale = typeScale(size);
  const lead = parts.lead ?? 'title';
  const share = { title: 1, quote: QUOTE_TITLE_SHARE, number: STAT_NUMBER_SHARE, question: QUESTION_TITLE_SHARE };
  const title = scale.title * K_MIN * share[lead];
  const floor = (px: number) => Math.max(SIZES[size].bodyFloor, px);
  const body = floor(scale.body * K_MIN);
  const option = floor(scale.body * ITEM_BODY_SHARE * K_MIN);
  return [
    { name: lead, text: lead === 'number' ? 'primary' : 'ink', on: 'background', px: title, headline: true },
    ...(lead === 'number'
      ? []
      : [{ name: `${lead} highlight`, text: 'primary', on: 'background', px: title, headline: true } as const]),
    ...(parts.person === true
      ? [{ name: 'person', text: 'ink', on: 'background', px: body } as const]
      : []),
    ...(parts.kicker === true
      ? [{ name: 'kicker', text: 'primary', on: 'background', px: scale.kicker * K_MIN } as const]
      : []),
    ...(parts.badge === true
      ? [{ name: 'badge', text: 'primary', on: 'background', px: SMALL_PRINT_PX } as const]
      : []),
    ...(parts.price === true
      ? [
          {
            name: 'price',
            text: 'primary',
            on: 'background',
            px: scale.title * K_MIN * OFFER_PRICE_SHARE,
            headline: true,
          } as const,
        ]
      : []),
    ...(parts.label === true
      ? [{ name: 'label', text: 'ink', on: 'background', px: floor(scale.body * STAT_LABEL_SHARE * K_MIN) } as const]
      : []),
    ...(parts.details === true
      ? [
          { name: 'details', text: 'ink', on: 'background', px: body } as const,
          { name: 'details highlight', text: 'primary', on: 'background', px: body } as const,
        ]
      : []),
    ...(parts.body === true
      ? [
          { name: 'body', text: 'ink', on: 'background', px: body } as const,
          { name: 'body highlight', text: 'primary', on: 'background', px: body } as const,
        ]
      : []),
    ...(parts.options === true
      ? [
          { name: 'option letter', text: 'primary', on: 'background', px: option } as const,
          { name: 'option', text: 'ink', on: 'background', px: option } as const,
          { name: 'option highlight', text: 'primary', on: 'background', px: option } as const,
          // The letter on a picture: white on the scrim the CSS paints behind it (`SCRIM_ALPHA`, §08)
          { name: 'letter on picture', text: { hex: '#ffffff' }, on: { photo: true }, px: SMALL_PRINT_PX } as const,
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

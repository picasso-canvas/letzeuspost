import { SCRIM_ALPHA } from '../contrast/scrim.ts';
import { IMAGE_BOX_MIN_SHARE } from '../fit/script.ts';
import { SIZES, SMALL_PRINT_PX, type SizeName } from '../sizes.ts';

// The CSS every slide shares, under the look's own (§08 Looks in the renderer). Print-safe only: no filter, backdrop
// blur or blend mode, so the PDF looks like the JPEG. Bangla (§07, §08): line-heights come from variables that the
// page sets per language (at least 1.65 for body and 1.3 for headings in Bangla), no letter-spacing, uppercase or
// italic anywhere, no hyphenation, balanced headings. Sizes are variables too (`sizeCss`): the fit script lowers `--k`
// and nothing else.
//
// The page is a flex column: an optional header (the logo, when it sits at the top), the text area, an optional
// footer (the logo at the bottom, and the page number). The text area keeps to the margins, which are the safe zones.

/** A quote is set at this share of the title's size: big enough to lead the slide, small enough for a sentence (the contrast pairs read it too). */
export const QUOTE_TITLE_SHARE = 0.9;
/** List items (and a question's options) are set a little larger than body text, since they are the slide's content. */
export const ITEM_BODY_SHARE = 1.15;
/** The stat number is the slide: twice the title's size. */
export const STAT_NUMBER_SHARE = 2;
/** The stat label says what the number counts, so it is a step above body text. */
export const STAT_LABEL_SHARE = 1.3;
/** A question is a sentence, not a headline: a little under the title's size (the contrast pairs read it too). */
export const QUESTION_TITLE_SHARE = 0.85;
/** The offer's price is the second thing a reader looks for, under the title (the contrast pairs read it too). */
export const OFFER_PRICE_SHARE = 0.75;
/** How tall a landscape box of pictures stands, as a share of the text area (as `COLUMN_IMAGE_SHARE` in `layouts/parts.ts`). */
const COLUMN_BOX_SHARE = 0.86;
/** A letter on a picture sits on this scrim: white text on black at the scrim rule's opacity (§08). */
const LETTER_SCRIM = `rgba(0, 0, 0, ${String(SCRIM_ALPHA)})`;

export const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html {
  margin: 0;
  padding: 0;
  hyphens: none;
  font-kerning: normal;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
body {
  margin: 0;
  width: var(--w);
  height: var(--h);
  overflow: hidden;
  background: var(--background);
  color: var(--ink);
  font-family: var(--font-body);
  font-weight: var(--weight-body);
}
.slide {
  display: flex;
  flex-direction: column;
  width: var(--w);
  height: var(--h);
  padding: var(--mt) var(--mr) var(--mb) var(--ml);
}
.text-area {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--gap);
}
.cols .text-area {
  flex-direction: row;
  align-items: center;
  gap: var(--column-gap);
}
.col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}
.cols .layout-fact .col-text { flex-grow: 3; }
.cols .layout-fact .image-box { flex-grow: 2; }
.cols .layout-list .col-text { flex-grow: 2; }
.cols .layout-list .col-detail { flex-grow: 3; }
.cols .layout-question .col-text { flex-grow: 2; }
.cols .layout-question .col-detail, .cols .layout-question .image-box { flex-grow: 3; }
.cols .layout-offer .col-text { flex-grow: 3; }
.cols .layout-offer .image-box { flex-grow: 2; }
.cols .layout-stat .col-text {
  /* The number is as wide as it is, up to half the area; wider is clamped, so the fit script sees it stick out */
  flex: 0 1 auto;
  max-width: 50%;
}
.cols .layout-stat .col-detail { flex: 1 1 0; }
.kicker {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: var(--weight-heading);
  font-size: calc(var(--kicker-size) * var(--k));
  line-height: var(--lh-heading);
  color: var(--accent);
}
.title {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: var(--weight-heading);
  font-size: calc(var(--title-size) * var(--k));
  line-height: var(--lh-heading);
  text-wrap: balance;
  overflow-wrap: break-word;
}
.body, .details {
  margin: 0;
  font-size: max(var(--body-floor), calc(var(--body-size) * var(--k)));
  line-height: var(--lh-body);
  text-wrap: pretty;
  overflow-wrap: break-word;
}
.small-print {
  margin: 0;
  font-size: ${String(SMALL_PRINT_PX)}px;
  line-height: var(--lh-body);
}
.image-box {
  flex: 1 1 0;
  min-width: 0;
  min-height: calc(var(--h) * ${String(IMAGE_BOX_MIN_SHARE)});
}
img.photo {
  display: block;
  object-fit: cover;
}
.cta-mark {
  display: block;
  align-self: flex-start;
  width: auto;
  max-width: 100%;
  object-fit: contain;
}
.cta-line {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: var(--weight-heading);
  font-size: max(var(--body-floor), calc(var(--body-size) * 1.15 * var(--k)));
  line-height: var(--lh-body);
  overflow-wrap: break-word;
}
.quote {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: var(--weight-heading);
  font-size: calc(var(--title-size) * ${String(QUOTE_TITLE_SHARE)} * var(--k));
  line-height: var(--lh-heading);
  text-wrap: balance;
  overflow-wrap: break-word;
}
.stack .layout-quote .quote {
  /* Stacked, the free height is shared: the quote centres in the room above the attribution, which sits at the foot,
     so no empty band is left above the footer. Auto margins take only what is left over (0 when the text fills the
     area), so what fits is unchanged and the fit script's measures don't move. */
  margin-top: auto;
  margin-bottom: auto;
}
.person {
  margin: 0;
  /* The attribution is a second group under the quote: its gap above is doubled, so it is set apart from the words */
  margin-top: var(--gap);
  font-family: var(--font-heading);
  font-weight: var(--weight-heading);
  font-size: max(var(--body-floor), calc(var(--body-size) * var(--k)));
  line-height: var(--lh-body);
  overflow-wrap: break-word;
}
.items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  font-size: max(var(--body-floor), calc(var(--body-size) * ${String(ITEM_BODY_SHARE)} * var(--k)));
  line-height: var(--lh-body);
  overflow-wrap: break-word;
}
.item {
  position: relative;
  padding-left: 1.3em;
}
.item::before {
  content: '';
  position: absolute;
  left: 0;
  top: calc((var(--lh-body) * 1em - 0.5em) / 2);
  width: 0.5em;
  height: 0.5em;
  border-radius: 50%;
  background: var(--primary);
}
.sticker, .step-label, .badge {
  font-family: var(--font-heading);
  font-weight: var(--weight-heading);
}
.badge { color: var(--primary); }
.sticker, .badge {
  /* Clamped to its column: a line wider than that sticks out of the box (overflow hidden makes scrollWidth exceed
     clientWidth), so the fit script measures it and names the sticker. Unclamped, the box grows with its text. */
  align-self: flex-start;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
}
.stat-number, .price {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: var(--weight-heading);
  line-height: var(--lh-heading);
  color: var(--primary);
  /* One line, clamped to its column: a number or price wider than that sticks out of the box (overflow hidden makes
     scrollWidth exceed clientWidth), so the fit script measures it and names it, as for the sticker. */
  white-space: nowrap;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}
.stat-number { font-size: calc(var(--title-size) * ${String(STAT_NUMBER_SHARE)} * var(--k)); }
.price { font-size: calc(var(--title-size) * ${String(OFFER_PRICE_SHARE)} * var(--k)); }
.stat-label {
  margin: 0;
  font-size: max(var(--body-floor), calc(var(--body-size) * ${String(STAT_LABEL_SHARE)} * var(--k)));
  line-height: var(--lh-body);
  text-wrap: balance;
  overflow-wrap: break-word;
}
.question {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: var(--weight-heading);
  font-size: calc(var(--title-size) * ${String(QUESTION_TITLE_SHARE)} * var(--k));
  line-height: var(--lh-heading);
  text-wrap: balance;
  overflow-wrap: break-word;
}
.options {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  font-size: max(var(--body-floor), calc(var(--body-size) * ${String(ITEM_BODY_SHARE)} * var(--k)));
  line-height: var(--lh-body);
  overflow-wrap: break-word;
}
.option {
  display: flex;
  align-items: flex-start;
  gap: 0.6em;
}
.option-mark {
  flex: none;
  min-width: 1em;
  font-family: var(--font-heading);
  font-weight: var(--weight-heading);
  color: var(--primary);
}
.option-text { min-width: 0; }
.option-thumb {
  flex: none;
  display: block;
  width: 3em;
  height: 3em;
  object-fit: cover;
}
.option-images {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: minmax(0, 1fr);
  gap: var(--gap);
}
.cols .option-images { height: calc((var(--h) - var(--mt) - var(--mb)) * ${String(COLUMN_BOX_SHARE)}); }
.option-image {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.option-image:last-child:nth-child(odd) { grid-column: 1 / -1; }
.option-image img.photo {
  position: absolute;
  top: 0;
  left: 0;
}
.option-image .option-mark {
  position: absolute;
  top: 0;
  left: 0;
  min-width: 0;
  padding: 0 0.5em;
  font-size: ${String(SMALL_PRINT_PX)}px;
  line-height: var(--lh-body);
  color: #ffffff;
  background: ${LETTER_SCRIM};
}
.page-number {
  font-size: ${String(SMALL_PRINT_PX)}px;
  line-height: var(--lh-body);
}
mark.hl {
  background: none;
  color: var(--primary);
}
.header, .footer {
  flex: none;
  display: flex;
  align-items: center;
}
.header { margin-bottom: var(--gap); }
.footer { margin-top: var(--gap); justify-content: space-between; }
.logo-bottom-right .footer { flex-direction: row-reverse; }
.logo-top .footer { justify-content: flex-end; }
.logo {
  display: block;
  height: 64px;
  width: auto;
  max-width: 320px;
  object-fit: contain;
}
`;

/** How big each kind of text is at `--k: 1`, per size: "smaller type" on a square, "larger" on a story (§08). */
const TYPE_SCALE: Record<
  SizeName,
  { title: number; body: number; kicker: number; gap: number; columnGap: number }
> = {
  portrait: { title: 96, body: 40, kicker: 32, gap: 32, columnGap: 0 },
  square: { title: 80, body: 36, kicker: 30, gap: 28, columnGap: 0 },
  story: { title: 108, body: 44, kicker: 36, gap: 40, columnGap: 0 },
  landscape: { title: 60, body: 38, kicker: 30, gap: 24, columnGap: 56 },
  pin: { title: 80, body: 28, kicker: 28, gap: 28, columnGap: 0 },
};

/** The variables of one size: its pixels, margins (= safe zones), body floor and type scale. */
export function sizeCss(size: SizeName): string {
  const { width, height, margins, bodyFloor } = SIZES[size];
  const type = TYPE_SCALE[size];
  const px = (value: number) => `${String(value)}px`;
  return `
:root {
  --w: ${px(width)};
  --h: ${px(height)};
  --mt: ${px(margins.top)};
  --mr: ${px(margins.right)};
  --mb: ${px(margins.bottom)};
  --ml: ${px(margins.left)};
  --body-floor: ${px(bodyFloor)};
  --title-size: ${px(type.title)};
  --body-size: ${px(type.body)};
  --kicker-size: ${px(type.kicker)};
  --gap: ${px(type.gap)};
  --column-gap: ${px(type.columnGap)};
  --k: 1;
}
`;
}

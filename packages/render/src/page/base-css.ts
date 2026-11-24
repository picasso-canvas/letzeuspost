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
/** List items are set a little larger than body text, since they are the slide's content. */
const ITEM_BODY_SHARE = 1.15;

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
.body {
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
.sticker, .step-label {
  font-family: var(--font-heading);
  font-weight: var(--weight-heading);
}
.sticker {
  /* Clamped to its column: a line wider than that sticks out of the box (overflow hidden makes scrollWidth exceed
     clientWidth), so the fit script measures it and names the sticker. Unclamped, the box grows with its text. */
  align-self: flex-start;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
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

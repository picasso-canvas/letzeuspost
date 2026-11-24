import { parseHighlights, type Post, type Slide } from '@lzp/core';
import { createElement as h, type ReactNode } from 'react';
import type { RenderKit } from '../kit.ts';
import { assetImage, assetUrl } from '../page/assets.ts';
import { formatNumber } from '../page/digits.ts';
import { SIZES, type SizeName } from '../sizes.ts';
import type { LayoutProps } from './types.ts';

// The pieces every layout shares: highlighted text, the logo, the page number and the header and footer around the
// text area.

/**
 * Text with its `*highlight*` markers read by `parseHighlights` (§07): each highlight becomes a `<mark>` element and
 * everything else stays text, which React escapes. Nothing here is ever HTML. A marker the parser rejects stays in the
 * text as a plain `*`; the text validator is where it is reported.
 */
export function richText(text: string): ReactNode[] {
  return parseHighlights(text).segments.map((segment) =>
    segment.highlight ? h('mark', { className: 'hl' }, segment.text) : segment.text,
  );
}

/** The source line's label, in the language of the post. */
export const SOURCE_LABEL = { en: 'Source:', bn: 'সূত্র:' } as const;

/** sRGB relative luminance of a `#rrggbb` colour, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The logo made for the page's background: the light one on a light background, the dark one on a dark one. */
export const logoKey = (kit: RenderKit): { field: string; key: string } =>
  luminance(kit.colors.background) > 0.18
    ? { field: 'kit.logo.light', key: kit.logo.light }
    : { field: 'kit.logo.dark', key: kit.logo.dark };

/** "2/5" for the slide's place in the post, in the language's digits; nothing for a single slide. */
function pageNumber(post: Post, slide: Slide): ReactNode {
  const index = post.slides.indexOf(slide);
  if (index < 0 || post.slides.length < 2) return null;
  const numbers = `${formatNumber(index + 1, post.lang)}/${formatNumber(post.slides.length, post.lang)}`;
  return h('span', { className: 'page-number' }, numbers);
}

/**
 * The logo, then the header and footer it and the page number go in, by the look's logo switch (set on `<body>`).
 * `withLogo: false` leaves the logo out, for a slide that already draws it as its mark; the page number stays.
 */
export function frame(
  props: Pick<LayoutProps<Slide['layout']>, 'post' | 'slide' | 'kit' | 'switches' | 'context'>,
  { withLogo = true }: { withLogo?: boolean } = {},
): { header: ReactNode; footer: ReactNode } {
  const { post, slide, kit, switches, context } = props;
  const logoAtTop = switches.logo === 'top';
  const { field, key } = logoKey(kit);
  const logo = withLogo ? assetImage(context, field, key, 'logo') : null;
  const number = pageNumber(post, slide);
  return {
    header: logoAtTop && logo !== null ? h('header', { className: 'header' }, logo) : null,
    footer:
      (!logoAtTop && logo !== null) || number !== null
        ? h('footer', { className: 'footer' }, logoAtTop ? null : logo, number)
        : null,
  };
}

/** True where a slide's text is the left column and its picture the right (§08: landscape). */
export const isColumns = (size: SizeName): boolean => SIZES[size].arrangement === 'columns';

/** The slide's place in its post, as the path a warning names (`slides[0]`). */
const slidePath = (post: Post, slide: Slide): string =>
  `slides[${String(Math.max(0, post.slides.indexOf(slide)))}]`;

/** How tall a landscape image stands, as a share of the text area: room left for a frame's border and tilt. */
const COLUMN_IMAGE_SHARE = 0.86;

/**
 * An `<img>` of a stored asset with a size given as attributes, since a page can carry no style of its own
 * (`page/content-policy.ts`). `assetImage` judges the key and warns for one that isn't an asset; only a key it accepts
 * gets an image, and its address is the job's own asset scheme.
 */
function sizedImage(
  props: Pick<LayoutProps<Slide['layout']>, 'context'>,
  field: string,
  key: string,
  className: string,
  attributes: { width?: string; height: string },
): ReactNode {
  if (assetImage(props.context, field, key, className) === null) return null;
  return h('img', { src: assetUrl('image', key), alt: '', className, ...attributes });
}

/**
 * A slide's photo in its image box (the image frame, corner and full-bleed switches style the box, §07). A photo whose
 * key isn't an asset leaves no box at all, and a warning, so no hole is left where it was.
 */
export function photoBox(
  props: Pick<LayoutProps<Slide['layout']>, 'post' | 'slide' | 'size' | 'context'>,
  asset: string,
): ReactNode {
  const { post, slide, size } = props;
  // A stacked image box takes the height the text leaves, so the image fills it; a column is only as tall as its
  // content, so a landscape image is given its height in pixels.
  const height = isColumns(size)
    ? String(Math.round(SIZES[size].textArea.height * COLUMN_IMAGE_SHARE))
    : '100%';
  const field = `${slidePath(post, slide)}.image.asset`;
  const photo = sizedImage(props, field, asset, 'photo', { width: '100%', height });
  return photo === null ? null : h('div', { className: 'image-box' }, photo);
}

/**
 * The picture that stands for the brand on the last slide: its logo or its mascot, at a height that is a share of the
 * text area, its width left to the picture so it keeps its shape. A mascot the kit doesn't have is the logo.
 */
export function brandMark(props: Pick<LayoutProps<'cta'>, 'slide' | 'kit' | 'size' | 'context'>): {
  mark: ReactNode;
  isLogo: boolean;
} {
  const { slide, kit, size } = props;
  const mascot = slide.mark === 'mascot' ? kit.mascot : undefined;
  const { field, key } = mascot === undefined ? logoKey(kit) : { field: 'kit.mascot', key: mascot };
  const share = isColumns(size) ? 0.2 : 0.16;
  const height = String(Math.round(SIZES[size].textArea.height * share));
  const mark = sizedImage(props, field, key, 'cta-mark', { height });
  return { mark, isLogo: mark !== null && mascot === undefined };
}

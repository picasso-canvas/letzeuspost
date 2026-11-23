import { parseHighlights, type Post, type Slide } from '@lzp/core';
import { createElement as h, type ReactNode } from 'react';
import type { RenderKit } from '../kit.ts';
import { assetImage } from '../page/assets.ts';
import { formatNumber } from '../page/digits.ts';
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

/** The logo, then the header and footer it and the page number go in, by the look's logo switch (set on `<body>`). */
export function frame(
  props: Pick<LayoutProps<Slide['layout']>, 'post' | 'slide' | 'kit' | 'switches' | 'context'>,
): { header: ReactNode; footer: ReactNode } {
  const { post, slide, kit, switches, context } = props;
  const logoAtTop = switches.logo === 'top';
  const { field, key } = logoKey(kit);
  const logo = assetImage(context, field, key, 'logo');
  const number = pageNumber(post, slide);
  return {
    header: logoAtTop && logo !== null ? h('header', { className: 'header' }, logo) : null,
    footer:
      (!logoAtTop && logo !== null) || number !== null
        ? h('footer', { className: 'footer' }, logoAtTop ? null : logo, number)
        : null,
  };
}

import { createElement as h, type ReactNode } from 'react';
import { registerPairs } from '../contrast/pairs.ts';
import { frame, isColumns, photoBox, richText } from './parts.ts';
import { layoutPairs } from './pairs.ts';
import type { LayoutProps } from './types.ts';

registerPairs('cover', ({ size }) =>
  layoutPairs({ kicker: true, body: true, smallPrint: true }, size),
);

/**
 * The `cover` layout (§07: kicker, title, body?, image?, sticker?): the first slide of a carousel. Stacked, the sticker,
 * kicker, title and body go one under another and the image takes what room is left under them. On landscape (§08: two
 * columns) the text is the left column and the image the right. A field that is missing leaves nothing behind: no
 * empty box, and with no image the text column has the whole width. Every text block is text the post gave, so it is
 * escaped; the sticker is plain text, a short word in small print.
 */
export function CoverLayout(props: LayoutProps<'cover'>): ReactNode {
  const { slide, size } = props;
  const sticker =
    slide.sticker === undefined
      ? null
      : h('p', { className: 'sticker small-print' }, slide.sticker);
  const kicker = h('p', { className: 'kicker' }, ...richText(slide.kicker));
  const title = h('h1', { className: 'title' }, ...richText(slide.title));
  const body =
    slide.body === undefined ? null : h('p', { className: 'body' }, ...richText(slide.body));
  const image = slide.image === undefined ? null : photoBox(props, slide.image.asset);
  const { header, footer } = frame(props);

  const blocks = isColumns(size)
    ? [h('div', { className: 'col col-text' }, sticker, kicker, title, body), image]
    : [sticker, kicker, title, body, image];

  return h(
    'main',
    { className: 'slide layout-cover' },
    header,
    h('div', { className: 'text-area' }, ...blocks),
    footer,
  );
}

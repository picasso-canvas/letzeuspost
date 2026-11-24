import { createElement as h, type ReactNode } from 'react';
import { registerPairs } from '../contrast/pairs.ts';
import { frame, isColumns, photoBox, richText, SOURCE_LABEL } from './parts.ts';
import { layoutPairs } from './pairs.ts';
import type { LayoutProps } from './types.ts';

registerPairs('fact', ({ size }) =>
  layoutPairs({ kicker: true, body: true, smallPrint: true }, size),
);

/**
 * The `fact` layout (§07: kicker, title, image?, body, source): one sourced fact. Stacked, the kicker, title, image,
 * body and source go one under another, the image taking what room the text leaves. On landscape (§08: two columns)
 * the text is the left column and the image the right. The source is required, so it is always drawn, as small print
 * under the body, with its label in the language of the post. With no image the text column has the whole width and
 * nothing is left behind. Every text block is text the post gave, so it is escaped.
 */
export function FactLayout(props: LayoutProps<'fact'>): ReactNode {
  const { post, slide, size } = props;
  const kicker = h('p', { className: 'kicker' }, ...richText(slide.kicker));
  const title = h('h1', { className: 'title' }, ...richText(slide.title));
  const body = h('p', { className: 'body' }, ...richText(slide.body));
  const source = h(
    'p',
    { className: 'source small-print' },
    `${SOURCE_LABEL[post.lang]} ${slide.source}`,
  );
  const image = slide.image === undefined ? null : photoBox(props, slide.image.asset);
  const { header, footer } = frame(props);

  const blocks = isColumns(size)
    ? [h('div', { className: 'col col-text' }, kicker, title, body, source), image]
    : [kicker, title, image, body, source];

  return h(
    'main',
    { className: 'slide layout-fact' },
    header,
    h('div', { className: 'text-area' }, ...blocks),
    footer,
  );
}

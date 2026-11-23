import { createElement as h, type ReactNode } from 'react';
import { SIZES } from '../sizes.ts';
import { frame, richText, SOURCE_LABEL } from './parts.ts';
import type { LayoutProps } from './types.ts';

/**
 * The `text` layout (§07: kicker, title, body, source?): type only. Stacked, the blocks go one under another inside the
 * margins. On landscape (§08: two columns) the kicker and title are the left column and the body and source the right,
 * since a type-only slide has no image for the right one. Every block is text the post gave, so it is escaped.
 */
export function TextLayout(props: LayoutProps<'text'>): ReactNode {
  const { post, slide, size } = props;
  const kicker = h('p', { className: 'kicker' }, ...richText(slide.kicker));
  const title = h('h1', { className: 'title' }, ...richText(slide.title));
  const body = h('p', { className: 'body' }, ...richText(slide.body));
  const source =
    slide.source === undefined
      ? null
      : h('p', { className: 'source small-print' }, `${SOURCE_LABEL[post.lang]} ${slide.source}`);
  const { header, footer } = frame(props);

  const blocks =
    SIZES[size].arrangement === 'columns'
      ? [
          h('div', { className: 'col col-text' }, kicker, title),
          h('div', { className: 'col col-detail' }, body, source),
        ]
      : [kicker, title, body, source];

  return h(
    'main',
    { className: 'slide layout-text' },
    header,
    h('div', { className: 'text-area' }, ...blocks),
    footer,
  );
}

import { createElement as h, type ReactNode } from 'react';
import { registerPairs } from '../contrast/pairs.ts';
import { frame, isColumns, richText, SOURCE_LABEL } from './parts.ts';
import { layoutPairs } from './pairs.ts';
import type { LayoutProps } from './types.ts';

registerPairs('quote', ({ size }) =>
  layoutPairs({ lead: 'quote', person: true, smallPrint: true }, size),
);

/**
 * The `quote` layout (§07: quote, person, role; a public quote shows its source): a line from the brand's people or a
 * sourced public quote. The quote leads, in quotation marks, then the person's name, their role and, when the slide has
 * a source, the source as small print. The words are text the post gave, so they are escaped. On landscape (§08: two
 * columns) everything is the left column and, since a quote has no image, the column has the whole width rather than
 * leaving the right one empty, as the `cta` layout does.
 */
export function QuoteLayout(props: LayoutProps<'quote'>): ReactNode {
  const { post, slide, size } = props;
  const quote = h('p', { className: 'quote' }, '“', ...richText(slide.quote), '”');
  const person = h('p', { className: 'person' }, slide.person);
  const role = h('p', { className: 'role small-print' }, slide.role);
  const source =
    slide.source === undefined
      ? null
      : h('p', { className: 'source small-print' }, `${SOURCE_LABEL[post.lang]} ${slide.source}`);
  const { header, footer } = frame(props);

  const blocks = [quote, person, role, source];
  return h(
    'main',
    { className: 'slide layout-quote' },
    header,
    h(
      'div',
      { className: 'text-area' },
      ...(isColumns(size) ? [h('div', { className: 'col col-text' }, ...blocks)] : blocks),
    ),
    footer,
  );
}

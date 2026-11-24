import { createElement as h, type ReactNode } from 'react';
import { registerPairs } from '../contrast/pairs.ts';
import { frame, isColumns, richText, SOURCE_LABEL } from './parts.ts';
import { layoutPairs } from './pairs.ts';
import type { LayoutProps } from './types.ts';

registerPairs('stat', ({ size }) =>
  layoutPairs({ lead: 'number', label: true, smallPrint: true }, size),
);

/**
 * The `stat` layout (§07: number, label, source; the source is required): a big number. Stacked, the number, the label
 * and the source go one under another, the number the biggest thing on the slide and the source small print at the
 * foot of the group. On landscape (§08: two columns) the number is the left column and the label and source the right:
 * a stat has no image, so the right column holds its words rather than staying empty, as the `list` layout's does. The
 * number is text the post gave and is drawn as it is (Bangla digits stay Bangla), on one line: a number too wide for
 * its column is named by the fit check, never wrapped. Every block is escaped.
 */
export function StatLayout(props: LayoutProps<'stat'>): ReactNode {
  const { post, slide, size } = props;
  const number = h('p', { className: 'stat-number' }, slide.number);
  const label = h('p', { className: 'stat-label' }, ...richText(slide.label));
  const source = h(
    'p',
    { className: 'source small-print' },
    `${SOURCE_LABEL[post.lang]} ${slide.source}`,
  );
  const { header, footer } = frame(props);

  const blocks = isColumns(size)
    ? [
        h('div', { className: 'col col-text' }, number),
        h('div', { className: 'col col-detail' }, label, source),
      ]
    : [number, label, source];

  return h(
    'main',
    { className: 'slide layout-stat' },
    header,
    h('div', { className: 'text-area' }, ...blocks),
    footer,
  );
}

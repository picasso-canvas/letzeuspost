import { createElement as h, type ReactNode } from 'react';
import { registerPairs } from '../contrast/pairs.ts';
import { frame, isColumns, richText } from './parts.ts';
import { layoutPairs } from './pairs.ts';
import type { LayoutProps } from './types.ts';

registerPairs('list', ({ size }) => layoutPairs({ body: true }, size));

/**
 * The `list` layout (§07: title, 3 to 5 items): tips and checklists. Stacked, the title and the items go one under
 * another. On landscape (§08: two columns) the title is the left column and the items the right: a list has no image,
 * so the right column holds the items, as the `text` layout's does, and nothing is left empty. The items are one block
 * to the fit check (the `items` field), each a list item with a dot drawn by the CSS. Every text is text the post gave,
 * so it is escaped; an item may carry a highlight.
 */
export function ListLayout(props: LayoutProps<'list'>): ReactNode {
  const { slide, size } = props;
  const title = h('h1', { className: 'title' }, ...richText(slide.title));
  const items = h(
    'ul',
    { className: 'items' },
    ...slide.items.map((item, index) =>
      h('li', { className: 'item', key: index }, ...richText(item)),
    ),
  );
  const { header, footer } = frame(props);

  const blocks = isColumns(size)
    ? [
        h('div', { className: 'col col-text' }, title),
        h('div', { className: 'col col-detail' }, items),
      ]
    : [title, items];

  return h(
    'main',
    { className: 'slide layout-list' },
    header,
    h('div', { className: 'text-area' }, ...blocks),
    footer,
  );
}

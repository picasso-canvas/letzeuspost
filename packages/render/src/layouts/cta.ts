import { createElement as h, type ReactNode } from 'react';
import { registerPairs } from '../contrast/pairs.ts';
import { brandMark, frame, isColumns, richText } from './parts.ts';
import { layoutPairs } from './pairs.ts';
import type { LayoutProps } from './types.ts';

registerPairs('cta', ({ size }) => layoutPairs({ body: true, cta: true, smallPrint: true }, size));

/**
 * The `cta` layout (§07: logo or mascot, title, body, call to action): the last slide of a carousel. The mark, the
 * title, the body and the call to action go one under another; on landscape (§08: two columns) they are all the left
 * column, and since this slide has no photo the column has the whole width rather than leaving the right one empty.
 * The call to action is a highlight, so the look's highlight switch styles it. When the mark is the logo, it is drawn
 * once, as the mark, and the corner logo is left out; a mascot is drawn beside the corner logo. Every text is text the
 * post gave, so it is escaped.
 */
export function CtaLayout(props: LayoutProps<'cta'>): ReactNode {
  const { slide, size } = props;
  const { mark, isLogo } = brandMark(props);
  const title = h('h1', { className: 'title' }, ...richText(slide.title));
  const body = h('p', { className: 'body' }, ...richText(slide.body));
  const action = h('p', { className: 'cta-line' }, h('mark', { className: 'hl' }, slide.cta));
  const { header, footer } = frame(props, { withLogo: !isLogo });

  const blocks = [mark, title, body, action];
  return h(
    'main',
    { className: 'slide layout-cta' },
    header,
    h(
      'div',
      { className: 'text-area' },
      ...(isColumns(size) ? [h('div', { className: 'col col-text' }, ...blocks)] : blocks),
    ),
    footer,
  );
}

import { createElement as h, type ReactNode } from 'react';
import { registerPairs } from '../contrast/pairs.ts';
import { frame, isColumns, photoBox, richText } from './parts.ts';
import { layoutPairs } from './pairs.ts';
import type { LayoutProps } from './types.ts';

registerPairs('offer', ({ size }) =>
  layoutPairs({ badge: true, price: true, details: true, cta: true }, size),
);

/**
 * The `offer` layout (§07: badge, title, details, price?, image?, call to action): a launch, a discount or an event.
 * Stacked, the badge, the title, the image, the price, the details and the call to action go one under another, the
 * image taking what room the text leaves. On landscape (§08: two columns) the text is the left column and the image
 * the right. The call to action is a highlight, so the look's highlight switch styles it. A price or image that is
 * missing leaves nothing behind: no empty box, and with no image the text column has the whole width. The badge and
 * the price are drawn as the post gave them, since §07 has prices and dates match the brief or the kit; every text
 * block is escaped.
 */
export function OfferLayout(props: LayoutProps<'offer'>): ReactNode {
  const { slide, size } = props;
  const badge = h('p', { className: 'badge small-print' }, slide.badge);
  const title = h('h1', { className: 'title' }, ...richText(slide.title));
  const price = slide.price === undefined ? null : h('p', { className: 'price' }, slide.price);
  const details = h('p', { className: 'details' }, ...richText(slide.details));
  const action = h('p', { className: 'cta-line' }, h('mark', { className: 'hl' }, slide.cta));
  const image = slide.image === undefined ? null : photoBox(props, slide.image.asset);
  const { header, footer } = frame(props);

  const blocks = isColumns(size)
    ? [h('div', { className: 'col col-text' }, badge, title, price, details, action), image]
    : [badge, title, image, price, details, action];

  return h(
    'main',
    { className: 'slide layout-offer' },
    header,
    h('div', { className: 'text-area' }, ...blocks),
    footer,
  );
}

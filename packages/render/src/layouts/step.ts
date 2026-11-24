import { createElement as h, type ReactNode } from 'react';
import { registerPairs } from '../contrast/pairs.ts';
import { formatNumber } from '../page/digits.ts';
import { frame, isColumns, photoBox, richText } from './parts.ts';
import { layoutPairs } from './pairs.ts';
import type { LayoutProps } from './types.ts';

registerPairs('step', ({ size }) => layoutPairs({ body: true, smallPrint: true }, size));

/** "Step 2 of 4", in the language of the post and its digits (§07: Bangla text takes Bangla digits). */
function stepLabel({ post, slide }: Pick<LayoutProps<'step'>, 'post' | 'slide'>): string {
  const [n, of] = [formatNumber(slide.n, post.lang), formatNumber(slide.of, post.lang)];
  return post.lang === 'bn' ? `ধাপ ${n} / ${of}` : `Step ${n} of ${of}`;
}

/**
 * The `step` layout (§07: step n/of, image, title, body): one step of a how-to per slide. Stacked, the step label, the
 * image, the title and the body go one under another, the image taking what room the text leaves. On landscape (§08:
 * two columns) the label, title and body are the left column and the image the right. The label is small print, not a
 * kicker: a step has no kicker field, so nothing the fit check names could be missing from the slide.
 */
export function StepLayout(props: LayoutProps<'step'>): ReactNode {
  const { slide, size } = props;
  const label = h('p', { className: 'step-label small-print' }, stepLabel(props));
  const title = h('h1', { className: 'title' }, ...richText(slide.title));
  const body = h('p', { className: 'body' }, ...richText(slide.body));
  const image = photoBox(props, slide.image.asset);
  const { header, footer } = frame(props);

  const blocks = isColumns(size)
    ? [h('div', { className: 'col col-text' }, label, title, body), image]
    : [label, image, title, body];

  return h(
    'main',
    { className: 'slide layout-step' },
    header,
    h('div', { className: 'text-area' }, ...blocks),
    footer,
  );
}

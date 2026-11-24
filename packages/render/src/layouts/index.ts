import type { Slide } from '@lzp/core';
import { createElement as h, type ReactNode } from 'react';
import { CoverLayout } from './cover.ts';
import { CtaLayout } from './cta.ts';
import { FactLayout } from './fact.ts';
import { ListLayout } from './list.ts';
import { QuoteLayout } from './quote.ts';
import { StepLayout } from './step.ts';
import { TextLayout } from './text.ts';
import type { LayoutProps } from './types.ts';

export type { LayoutProps };

/** Draws a slide with its layout. The other layouts plug in here as they are built (§07, §08). */
export function renderLayout(props: LayoutProps<Slide['layout']>): ReactNode {
  const { slide } = props;
  switch (slide.layout) {
    case 'cover':
      return h(CoverLayout, { ...props, slide });
    case 'fact':
      return h(FactLayout, { ...props, slide });
    case 'step':
      return h(StepLayout, { ...props, slide });
    case 'list':
      return h(ListLayout, { ...props, slide });
    case 'quote':
      return h(QuoteLayout, { ...props, slide });
    case 'cta':
      return h(CtaLayout, { ...props, slide });
    case 'text':
      return h(TextLayout, { ...props, slide });
    default:
      throw new Error(`The "${slide.layout}" layout isn't built yet`);
  }
}

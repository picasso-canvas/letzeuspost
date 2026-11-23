import type { Slide } from '@lzp/core';
import { createElement as h, type ReactNode } from 'react';
import { TextLayout } from './text.ts';
import type { LayoutProps } from './types.ts';

export type { LayoutProps };

/** Draws a slide with its layout. The other layouts plug in here as they are built (§07, §08). */
export function renderLayout(props: LayoutProps<Slide['layout']>): ReactNode {
  const { slide } = props;
  switch (slide.layout) {
    case 'text':
      return h(TextLayout, { ...props, slide });
    default:
      throw new Error(`The "${slide.layout}" layout isn't built yet`);
  }
}

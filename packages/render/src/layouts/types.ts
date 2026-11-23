import type { Post, Slide, SizeName } from '@lzp/core';
import type { RenderKit } from '../kit.ts';
import type { BuildContext } from '../page/assets.ts';
import type { Switches } from '../page/switches.ts';

/** What a layout gets: the post, its own slide (typed by layout), the size, the kit, the look's switches, and where to put warnings. */
export type LayoutProps<L extends Slide['layout']> = {
  post: Post;
  slide: Extract<Slide, { layout: L }>;
  size: SizeName;
  kit: RenderKit;
  switches: Switches;
  context: BuildContext;
};

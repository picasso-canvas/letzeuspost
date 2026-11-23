import type { Post, SizeName, Slide } from '../../packages/core/src/index.ts';
import type { LookDefinition, RenderKit } from '../../packages/render/src/kit.ts';
import { TEST_LOOK, testKit } from '../../packages/render/src/page/test-fixtures.ts';

// Real slides for the render specs, from the render package's own `buildSlide`. The builder is React, whose types
// only the render package has (`page/react-types.d.ts`, which the root typecheck can't load), so it is imported here
// by a computed path and given the type it has there; the render package's typecheck and tests cover the builder.

type Builder = {
  buildSlide: (post: Post, slide: Slide, size: SizeName, kit: RenderKit) => string;
  registerLook: (look: LookDefinition) => void;
};

const BUILDER = new URL('../../packages/render/src/index.ts', import.meta.url).href;

let builder: Promise<Builder> | undefined;

/** The page of the post's slide `index` (the first by default), at `size` (portrait by default), in the test kit and the test look. */
export async function slidePage(
  post: Post,
  size: SizeName = 'portrait',
  index = 0,
): Promise<string> {
  builder ??= (import(BUILDER) as Promise<Builder>).then((loaded) => {
    loaded.registerLook(TEST_LOOK);
    return loaded;
  });
  const { buildSlide } = await builder;
  const slide = post.slides[index];
  if (slide === undefined) throw new Error('no slide');
  return buildSlide(post, slide, size, testKit());
}

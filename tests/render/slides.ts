import type { Post, SizeName, Slide } from '../../packages/core/src/index.ts';
import type { RenderAsset } from '../../packages/render/src/browser/requests.ts';
import type { RenderPageInput, RenderResult } from '../../packages/render/src/browser/runner.ts';
import type { FitReport } from '../../packages/render/src/fit/report.ts';
import type { LookDefinition, RenderKit } from '../../packages/render/src/kit.ts';
import { TEST_LOOK, testKit } from '../../packages/render/src/page/test-fixtures.ts';

// Real slides for the render specs, from the render package's own `buildSlide`. The builder is React, whose types
// only the render package has (`page/react-types.d.ts`, which the root typecheck can't load), so it is imported here
// by a computed path and given the type it has there; the render package's typecheck and tests cover the builder.

/** What `renderSlide` needs of the runner, and what it returns (the render package's own `FitRenderer` and `RenderedSlide`). */
export type FitRenderer = { renderPage: (input: RenderPageInput) => Promise<RenderResult> };
export type RenderedSlide = {
  png: Uint8Array;
  report: FitReport;
  render: Omit<RenderResult, 'png' | 'fit'>;
};

type Builder = {
  buildSlide: (post: Post, slide: Slide, size: SizeName, kit: RenderKit) => string;
  registerLook: (look: LookDefinition) => void;
  renderSlide: (
    renderer: FitRenderer,
    input: {
      post: Post;
      slide: Slide;
      size: SizeName;
      kit: RenderKit;
      assets: readonly RenderAsset[];
      jobId: string;
    },
  ) => Promise<RenderedSlide>;
  fitOrder: (sizes: readonly SizeName[]) => SizeName[];
};

const BUILDER = new URL('../../packages/render/src/index.ts', import.meta.url).href;

let builder: Promise<Builder> | undefined;

function loadBuilder(): Promise<Builder> {
  builder ??= (import(BUILDER) as Promise<Builder>).then((loaded) => {
    loaded.registerLook(TEST_LOOK);
    return loaded;
  });
  return builder;
}

/** The page of the post's slide `index` (the first by default), at `size` (portrait by default), in the test kit and the test look. */
export async function slidePage(
  post: Post,
  size: SizeName = 'portrait',
  index = 0,
): Promise<string> {
  const { buildSlide } = await loadBuilder();
  const slide = post.slides[index];
  if (slide === undefined) throw new Error('no slide');
  return buildSlide(post, slide, size, testKit());
}

/** `renderSlide` from the render package, for the post's slide `index` (the first by default), in the test kit. */
export async function renderPostSlide(
  renderer: FitRenderer,
  post: Post,
  size: SizeName,
  assets: readonly RenderAsset[],
  index = 0,
): Promise<RenderedSlide> {
  const { renderSlide } = await loadBuilder();
  const slide = post.slides[index];
  if (slide === undefined) throw new Error('no slide');
  return renderSlide(renderer, { post, slide, size, kit: testKit(), assets, jobId: 'job-fit' });
}

/** `fitOrder` from the render package. */
export async function orderOf(sizes: readonly SizeName[]): Promise<SizeName[]> {
  return (await loadBuilder()).fitOrder(sizes);
}

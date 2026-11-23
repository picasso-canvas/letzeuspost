import type { Post, SizeName, Slide } from '@lzp/core';
import { RenderFailure } from '../browser/limits.ts';
import type { RenderAsset, RenderPageInput, RenderResult } from '../browser/index.ts';
import type { RenderKit } from '../kit.ts';
import type { BuildWarning } from '../page/assets.ts';
import { buildSlideWithWarnings } from '../page/build-slide.ts';
import { buildFitReport, PageFitSchema, type FitReport } from './report.ts';

/**
 * What `renderSlide` needs of the page runner (`createRenderer` in `@lzp/render/browser`): its `renderPage`, whose
 * result carries `fit`, what the fit script reported (`window.lzpFit`), once the runner has waited for the script and
 * before it takes the screenshot. A type of its own, so this entry never loads Playwright (the editor loads it too).
 */
export type FitRenderer = {
  renderPage: (input: RenderPageInput) => Promise<Omit<RenderResult, 'fit'> & { fit?: unknown }>;
};

export type RenderSlideInput = {
  post: Post;
  /** One of `post.slides`. */
  slide: Slide;
  size: SizeName;
  kit: RenderKit;
  /** The job's own images and uploaded fonts. */
  assets: readonly RenderAsset[];
  jobId: string;
  /** When the post must be done (`postDeadline`). */
  deadline?: number;
};

export type RenderedSlide = {
  /** The PNG master, drawn at the scale the fit script picked. */
  png: Uint8Array;
  report: FitReport;
  /** What `buildSlide` left out of the page. */
  warnings: BuildWarning[];
  /** The rest of what the runner returned: the assets served and blocked, the fonts that drew each block, the errors. */
  render: Omit<RenderResult, 'png' | 'fit'>;
};

/**
 * One slide at one size (§08): `buildSlide`'s page, drawn by the runner, with the fit report made from what the page's
 * fit script measured. Render a post's sizes in `fitOrder`, the one with the least text room first. Throws
 * `RenderFailure` when the runner gives no fit result or one the script could not have made.
 */
export async function renderSlide(
  renderer: FitRenderer,
  input: RenderSlideInput,
): Promise<RenderedSlide> {
  const { post, slide, size, kit, assets, jobId, deadline } = input;
  const slideIndex = post.slides.indexOf(slide);
  if (slideIndex < 0) throw new Error('The slide is not in the post');

  const { html, warnings } = buildSlideWithWarnings(post, slide, size, kit);
  const { fit, png, ...render } = await renderer.renderPage({
    html,
    assets,
    size,
    jobId,
    ...(deadline === undefined ? {} : { deadline }),
  });
  if (fit === undefined) throw new RenderFailure('The render browser gave no fit result');
  const measured = PageFitSchema.safeParse(fit);
  if (!measured.success)
    throw new RenderFailure('The page’s fit result is not one the fit script makes', {
      cause: measured.error,
    });

  return { png, report: buildFitReport(post, slideIndex, size, measured.data), warnings, render };
}

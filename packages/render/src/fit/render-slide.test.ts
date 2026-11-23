import { beforeAll, describe, expect, it } from 'vitest';
import { RenderFailure } from '../browser/limits.ts';
import type { RenderPageInput, RenderResult } from '../browser/runner.ts';
import { registerLook } from '../page/looks.ts';
import { buildSlide } from '../page/build-slide.ts';
import { TEST_LOOK, testKit, testPost, testSlide } from '../page/test-fixtures.ts';
import { FIT_SCRIPT } from './script.ts';
import { renderSlide, type FitRenderer } from './render-slide.ts';

beforeAll(() => {
  registerLook(TEST_LOOK);
});

const PNG = new Uint8Array([137, 80, 78, 71]);

const result = (fit?: unknown): RenderResult & { fit?: unknown } => ({
  png: PNG,
  width: 1080,
  height: 1350,
  served: [],
  blocked: [],
  fonts: [],
  errors: [],
  ...(fit === undefined ? {} : { fit }),
});

/** A renderer that records what it was asked to draw and answers with `fit`. */
function fake(fit?: unknown) {
  const calls: RenderPageInput[] = [];
  const renderer: FitRenderer = {
    renderPage: (input) => {
      calls.push(input);
      return Promise.resolve(result(fit));
    },
  };
  return { renderer, calls };
}

const input = () => {
  const post = testPost();
  const slide = post.slides[0];
  if (slide === undefined) throw new Error('no slide');
  return { post, slide, size: 'portrait' as const, kit: testKit(), assets: [], jobId: 'job-7' };
};

describe('renderSlide', () => {
  it('draws buildSlide’s page at the size and returns the PNG master with the report', async () => {
    const { renderer, calls } = fake({ k: 0.9, fits: true, fields: [] });
    const given = input();
    const drawn = await renderSlide(renderer, given);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.html).toBe(buildSlide(given.post, given.slide, 'portrait', given.kit));
    expect(calls[0]?.html).toContain(FIT_SCRIPT);
    expect(calls[0]).toMatchObject({ size: 'portrait', jobId: 'job-7', assets: [] });
    expect(drawn.png).toBe(PNG);
    expect(drawn.report).toEqual({
      size: 'portrait',
      slide: 1,
      k: 0.9,
      status: 'pass',
      fields: [],
    });
  });

  it('names the fields to shorten when the slide does not fit at 0.85', async () => {
    const { renderer } = fake({
      k: 0.85,
      fits: false,
      fields: [{ name: 'title', lines: 5, needed: 500, available: 250, overflowPx: 250 }],
    });
    const given = input();
    const slide = testSlide({ title: 'x'.repeat(40) });
    const drawn = await renderSlide(renderer, { ...given, post: testPost(slide), slide });
    expect(drawn.report.status).toBe('fail');
    expect(drawn.report.fields).toEqual([
      { field: 'slides[0].title', lines: 5, graphemes: 40, overflowPx: 250, targetGraphemes: 19 },
    ]);
  });

  it('passes the post’s deadline on to the runner', async () => {
    const { renderer, calls } = fake({ k: 1, fits: true, fields: [] });
    await renderSlide(renderer, { ...input(), deadline: 123_456 });
    expect(calls[0]?.deadline).toBe(123_456);
  });

  it('fails the render, saying why, when the runner returned no fit result', async () => {
    const { renderer } = fake();
    await expect(renderSlide(renderer, input())).rejects.toThrow(RenderFailure);
    await expect(renderSlide(renderer, input())).rejects.toThrow(/fit/);
  });

  it('fails the render when the page’s fit result is not one the script could have made', async () => {
    const { renderer } = fake({ k: 3, fits: true, fields: [] });
    await expect(renderSlide(renderer, input())).rejects.toThrow(RenderFailure);
  });

  it('refuses a slide that is not in the post', async () => {
    const { renderer, calls } = fake({ k: 1, fits: true, fields: [] });
    await expect(
      renderSlide(renderer, { ...input(), slide: testSlide() }),
    ).rejects.toThrow(/not in the post/);
    expect(calls).toHaveLength(0);
  });
});

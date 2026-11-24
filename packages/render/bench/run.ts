import { chromium, type Browser } from 'playwright-core';
import { createRenderer, LAUNCH_OPTIONS } from '../src/browser/index.ts';
import { renderSlide } from '../src/fit/render-slide.ts';
// Loading the looks registers them with the builder, as the worker does before its first render.
import '../src/looks/index.ts';
import { sampleAssets } from './assets.ts';
import { sampleBatch, takeRenders } from './batch.ts';
import { browserBytes } from './probe.ts';
import type { BenchResult, SlideTiming } from './report.ts';
import type { MemorySample } from './soak.ts';

export type RunOptions = {
  /** How many slide renders; the sample batch starts again from its first render when this is more than it holds. */
  renders: number;
  /** The renderer's own restart limit (§08: 500) when left out. */
  rendersPerBrowser?: number;
  /** Called after each render with how many are done. */
  progress?: (done: number, total: number) => void;
};

/**
 * Renders the sample batch one slide at a time through the real renderer (`createRenderer` and `renderSlide`, the
 * worker's own path), timing each slide and reading the browser's memory after each render and just before each browser
 * closes (the renderer closes a retired browser inside the render that retires it, so it can't be read after). Slides
 * render one after another: the numbers are for one page at a time, which is what §14 multiplies by its page count.
 */
export async function runBench(options: RunOptions): Promise<BenchResult> {
  const jobs = takeRenders(sampleBatch(), options.renders);
  const assets = await sampleAssets();

  let starts = 0;
  let done = 0;
  let rendering = false;
  let current: Browser | undefined;
  const samples: MemorySample[] = [];

  const sample = async (browser: Browser, render: number): Promise<void> => {
    const bytes = await browserBytes(browser).catch(() => undefined);
    if (bytes !== undefined) samples.push({ render, bytes });
  };

  // The browser the renderer would start, counted. Its memory is read as it closes: that is when the renderer retires it
  // (after `rendersPerBrowser` renders, or past its memory limit), so it is what the browser grew to over its life.
  const launch = async (): Promise<Browser> => {
    const browser = await chromium.launch(LAUNCH_OPTIONS);
    starts += 1;
    current = browser;
    const close = browser.close.bind(browser);
    browser.close = async (closeOptions) => {
      if (browser.isConnected()) await sample(browser, done + (rendering ? 1 : 0));
      await close(closeOptions);
    };
    return browser;
  };

  const renderer = createRenderer({
    log: () => undefined,
    launch,
    ...(options.rendersPerBrowser === undefined
      ? {}
      : { limits: { rendersPerBrowser: options.rendersPerBrowser } }),
  });

  const slides: SlideTiming[] = [];
  try {
    for (const [index, job] of jobs.entries()) {
      const startsBefore = starts;
      rendering = true;
      const begin = performance.now();
      try {
        await renderSlide(renderer, {
          post: job.post,
          slide: job.slide,
          size: job.size,
          kit: job.kit,
          assets,
          jobId: `${job.postId}-${String(index + 1)}`,
        });
      } finally {
        rendering = false;
      }
      const ms = Math.round(performance.now() - begin);
      done += 1;
      slides.push({ size: job.size, ms, startedBrowser: starts !== startsBefore });
      // Not timed: the browser may have just been retired, and a closed one is skipped (its memory was read as it closed).
      if (current?.isConnected() === true) await sample(current, done);
      options.progress?.(done, jobs.length);
    }
  } finally {
    await renderer.close();
  }

  const bytes = samples.map((s) => s.bytes);
  const finalBytes = samples.at(-1)?.bytes;
  return {
    slides,
    totalMs: slides.reduce((sum, slide) => sum + slide.ms, 0),
    browserStarts: starts,
    memory: {
      samples,
      ...(bytes.length === 0 ? {} : { peakBytes: Math.max(...bytes) }),
      ...(finalBytes === undefined ? {} : { finalBytes }),
    },
    ...(current === undefined ? {} : { browserVersion: current.version() }),
  };
}

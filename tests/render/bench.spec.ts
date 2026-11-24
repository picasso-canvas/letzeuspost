import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  CI_P95_CEILING_MS,
  CI_RENDERS,
  CI_RENDERS_PER_BROWSER,
} from '../../packages/render/bench/config.ts';
import type { BenchResult } from '../../packages/render/bench/report.ts';

// The short version of the render benchmark (#342, §08 "When renders happen, and caching"): CI_RENDERS slide renders of the
// sample batch through the real renderer, with the browser's restart count lowered to CI_RENDERS_PER_BROWSER. It runs in
// CI's services job, the `render` Playwright project. The 1.5 s target is for the production server, so p95 is held to
// the loose ceiling in `bench/config.ts`, which only catches a render gone wrong. The real measurement, and the
// 1,000-render soak (`LZP_RENDER_SOAK=1`, never set in CI), are run by hand: packages/render/bench/README.md.
//
// The bench is loaded by a computed path and given the type it has there, as `slides.ts` does for the builder: it runs
// React, whose types only the render package has, so the root typecheck can't load it. The render package's own tests
// cover its parts.

type Bench = {
  runBench: (options: { renders: number; rendersPerBrowser?: number }) => Promise<BenchResult>;
  formatReport: (result: BenchResult) => string;
  overallP95: (result: BenchResult) => number;
};

const BENCH = new URL('../../packages/render/bench/index.ts', import.meta.url).href;

test('50 renders: p95 is under the CI ceiling and the browser restarts at its lowered limit', async () => {
  test.setTimeout(300_000);
  const bench = (await import(BENCH)) as Bench;

  const result = await bench.runBench({
    renders: CI_RENDERS,
    rendersPerBrowser: CI_RENDERS_PER_BROWSER,
  });

  // The numbers go to the CI log and, as a file, to the render-output artifact: the PR records one run's.
  const report = bench.formatReport(result);
  console.log(report);
  await writeFile(test.info().outputPath('render-bench.txt'), report);
  await test.info().attach('render-bench', { body: report, contentType: 'text/plain' });

  expect(result.slides).toHaveLength(CI_RENDERS);
  expect(bench.overallP95(result)).toBeLessThan(CI_P95_CEILING_MS);

  // 50 renders at 20 a browser: a browser starts at render 1, 21 and 41, so it restarted twice, and each of those
  // renders is the one that started it.
  expect(result.browserStarts).toBe(Math.ceil(CI_RENDERS / CI_RENDERS_PER_BROWSER));
  expect(result.slides.flatMap((slide, i) => (slide.startedBrowser ? [i + 1] : []))).toEqual([
    1,
    CI_RENDERS_PER_BROWSER + 1,
    2 * CI_RENDERS_PER_BROWSER + 1,
  ]);

  // The memory could be read (from /proc on the CI image) and the last reading is the last browser's, as it closed.
  expect(result.memory.peakBytes).toBeGreaterThan(0);
  expect(result.memory.finalBytes).toBeGreaterThan(0);
});

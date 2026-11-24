// What the render benchmark's Playwright spec (`tests/render/bench.spec.ts`) uses. It has its own entry, not
// `src/index.ts`'s: it starts a real browser and reads `/proc`.
export {
  CI_P95_CEILING_MS,
  CI_RENDERS,
  CI_RENDERS_PER_BROWSER,
  SOAK_BASELINE_RENDERS,
  SOAK_MARGIN,
  SOAK_RENDERS,
  TARGET_P95_MS,
  optionsFromEnv,
  type BenchOptions,
} from './config.ts';
export { formatReport, overallP95, type BenchResult, type SlideTiming } from './report.ts';
export { runBench, type RunOptions } from './run.ts';
export { checkSoak, type MemorySample, type SoakVerdict } from './soak.ts';

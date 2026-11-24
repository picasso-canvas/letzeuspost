import type { SizeName } from '../src/sizes.ts';
import { TARGET_P95_MS } from './config.ts';
import type { MemorySample } from './soak.ts';
import { percentile, summarizeBySize } from './stats.ts';

/** One slide render's time; `startedBrowser` when it also had to start Chromium (the first, and after each restart). */
export type SlideTiming = { size: SizeName; ms: number; startedBrowser: boolean };

export type BenchResult = {
  slides: SlideTiming[];
  totalMs: number;
  /** How many browsers were started: the first, and one per restart. */
  browserStarts: number;
  memory: { samples: MemorySample[]; peakBytes?: number; finalBytes?: number };
};

// A render that starts the browser pays for Chromium's launch, once in 500 renders (§08): it is reported on its own line,
// and the percentiles are of the other renders, so a restart in a short run doesn't decide the 95th percentile.
const warm = (result: BenchResult): SlideTiming[] =>
  result.slides.filter((slide) => !slide.startedBrowser);

/** The 95th percentile of every render that didn't start the browser, all sizes together. */
export function overallP95(result: BenchResult): number {
  return percentile(
    warm(result).map((slide) => slide.ms),
    95,
  );
}

const MB = 1024 * 1024;
const pad = (value: string | number, width: number): string => String(value).padStart(width);

function duration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)} min ${(seconds - minutes * 60).toFixed(1)} s`;
}

const memory = (bytes: number | undefined): string =>
  bytes === undefined ? 'not readable' : `${String(Math.round(bytes / MB))} MB`;

/** The text the runner prints, and what the README asks to be sent back. */
export function formatReport(result: BenchResult): string {
  const rows = summarizeBySize(warm(result));
  const lines = [
    `Render benchmark: ${String(result.slides.length)} slide renders`,
    '',
    `${'size'.padEnd(10)}${pad('renders', 9)}${pad('p50 ms', 9)}${pad('p95 ms', 9)}${pad('max ms', 9)}  ${String(TARGET_P95_MS)} ms target`,
    ...rows.map(
      (row) =>
        `${row.size.padEnd(10)}${pad(row.count, 9)}${pad(row.p50, 9)}${pad(row.p95, 9)}${pad(row.max, 9)}  ${row.p95 <= TARGET_P95_MS ? 'within' : 'over'}`,
    ),
    '',
  ];
  const started = result.slides.filter((slide) => slide.startedBrowser);
  if (started.length > 0)
    lines.push(
      `${String(started.length)} render${started.length === 1 ? '' : 's'} started a browser and ${started.length === 1 ? 'is' : 'are'} left out of the table; the slowest took ${String(Math.max(...started.map((slide) => slide.ms)))} ms`,
    );
  lines.push(
    `total time        ${duration(result.totalMs)}`,
    `peak memory       ${memory(result.memory.peakBytes)}`,
    `final memory      ${memory(result.memory.finalBytes)}`,
    `browser restarts  ${String(Math.max(0, result.browserStarts - 1))}`,
  );
  return lines.join('\n');
}

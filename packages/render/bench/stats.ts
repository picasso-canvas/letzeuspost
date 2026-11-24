import { SIZE_NAMES, type SizeName } from '../src/sizes.ts';

export type Summary = { count: number; p50: number; p95: number; max: number };

/** The nearest-rank percentile: the smallest value that `p`% of `values` are at or under. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error('There is nothing to measure');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? 0;
}

export function summarize(values: readonly number[]): Summary | undefined {
  if (values.length === 0) return undefined;
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(...values),
  };
}

/** One row per size that was rendered, in `SIZE_NAMES` order. */
export function summarizeBySize(
  samples: readonly { size: SizeName; ms: number }[],
): (Summary & { size: SizeName })[] {
  return SIZE_NAMES.flatMap((size) => {
    const summary = summarize(samples.filter((sample) => sample.size === size).map((s) => s.ms));
    return summary === undefined ? [] : [{ size, ...summary }];
  });
}

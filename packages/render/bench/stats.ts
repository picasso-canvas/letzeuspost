import type { SizeName } from '../src/sizes.ts';

export type Summary = { count: number; p50: number; p95: number; max: number };

export function percentile(_values: readonly number[], _p: number): number {
  return 0;
}

export function summarize(_values: readonly number[]): Summary | undefined {
  return { count: 0, p50: 0, p95: 0, max: 0 };
}

export function summarizeBySize(
  _samples: readonly { size: SizeName; ms: number }[],
): (Summary & { size: SizeName })[] {
  return [];
}

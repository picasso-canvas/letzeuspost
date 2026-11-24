import type { SizeName } from '../src/sizes.ts';
import type { MemorySample } from './soak.ts';

/** One slide render's time; `startedBrowser` when it also had to start Chromium (the first, and after each restart). */
export type SlideTiming = { size: SizeName; ms: number; startedBrowser: boolean };

export type BenchResult = {
  slides: SlideTiming[];
  totalMs: number;
  /** How many browsers were started: the first, and one per restart. */
  browserStarts: number;
  memory: { samples: MemorySample[]; peakBytes?: number; finalBytes?: number };
};

export function overallP95(_result: BenchResult): number {
  return 0;
}

export function formatReport(_result: BenchResult): string {
  return '';
}

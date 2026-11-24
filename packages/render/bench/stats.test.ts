import { describe, expect, it } from 'vitest';
import { percentile, summarize, summarizeBySize } from './stats.ts';

describe('percentile (nearest rank)', () => {
  const ms = Array.from({ length: 100 }, (_, i) => i + 1);

  it('takes the value that 95% of the renders are at or under', () => {
    expect(percentile(ms, 50)).toBe(50);
    expect(percentile(ms, 95)).toBe(95);
    expect(percentile(ms, 100)).toBe(100);
  });

  it('does not depend on the order the renders came in', () => {
    expect(percentile([...ms].reverse(), 95)).toBe(95);
  });

  it('rounds up, so a few renders never hide the slowest one', () => {
    expect(percentile([100, 200, 300], 95)).toBe(300);
    expect(percentile([100, 200, 300], 50)).toBe(200);
    expect(percentile([7], 95)).toBe(7);
  });

  it('refuses nothing to measure, rather than answering 0', () => {
    expect(() => percentile([], 95)).toThrow('nothing to measure');
  });
});

describe('summarize', () => {
  it('gives the count, p50, p95 and max', () => {
    expect(summarize([400, 100, 300, 200])).toEqual({ count: 4, p50: 200, p95: 400, max: 400 });
  });

  it('is nothing for no renders', () => {
    expect(summarize([])).toBeUndefined();
  });
});

describe('summarizeBySize', () => {
  it('groups by size, in the sizes’ own order, and leaves out a size with no renders', () => {
    const rows = summarizeBySize([
      { size: 'story', ms: 900 },
      { size: 'portrait', ms: 300 },
      { size: 'story', ms: 700 },
      { size: 'portrait', ms: 500 },
    ]);
    expect(rows).toEqual([
      { size: 'portrait', count: 2, p50: 300, p95: 500, max: 500 },
      { size: 'story', count: 2, p50: 700, p95: 900, max: 900 },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { countWords } from './words.ts';

describe('countWords', () => {
  it('counts 0 for an empty or blank text', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  \n\t ')).toBe(0);
  });

  it('counts English words split by any run of spaces', () => {
    expect(countWords('Fresh pitha today')).toBe(3);
    expect(countWords('  Fresh   pitha\ttoday\n')).toBe(3);
  });

  it('counts Bangla words', () => {
    expect(countWords('ফিরে এল পিঠা সপ্তাহ')).toBe(4);
  });

  it('ignores the * that marks a highlight, one word or several', () => {
    expect(countWords('ফিরে এল *পিঠা* সপ্তাহ')).toBe(4);
    expect(countWords('Try *two words* now')).toBe(4);
    expect(countWords('*')).toBe(0);
  });
});

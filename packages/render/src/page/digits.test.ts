import { describe, expect, it } from 'vitest';
import { formatNumber } from './digits.ts';

describe('formatNumber', () => {
  it('writes English numbers with Latin digits', () => {
    expect(formatNumber(1234567890, 'en')).toBe('1234567890');
  });

  it('writes Bangla numbers with Bangla digits (০–৯, §07)', () => {
    expect(formatNumber(1234567890, 'bn')).toBe('১২৩৪৫৬৭৮৯০');
    expect(formatNumber(10, 'bn')).toBe('১০');
    expect(formatNumber(0, 'bn')).toBe('০');
  });
});

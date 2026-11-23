import { describe, expect, it } from 'vitest';
import { targetGraphemes } from './target.ts';

// §08: `targetGraphemes` is the current length × (room available ÷ room needed at 85%) × 0.95.
describe('targetGraphemes', () => {
  it('is 38 for a 52-grapheme title with 600 px of room where 780 px are needed (52 × 600/780 × 0.95)', () => {
    expect(targetGraphemes(52, 600, 780)).toBe(38);
  });

  it('keeps 95% of the length when the text needs exactly the room it has, scaled by the ratio', () => {
    // 40 × (900 ÷ 1000) × 0.95 = 34.2, and a target is never rounded up past the room: 34
    expect(targetGraphemes(40, 900, 1000)).toBe(34);
    // 50 × (500 ÷ 1000) × 0.95 = 23.75: 23, not 24
    expect(targetGraphemes(50, 500, 1000)).toBe(23);
  });

  it('is not thrown off by floating-point error where the exact answer is a whole number', () => {
    // 0.95 × 100 × 400 ÷ 800 = 47.5 → 47; 0.95 × 60 × 200 ÷ 300 = 38 exactly (a naive product gives 37.99999…)
    expect(targetGraphemes(100, 400, 800)).toBe(47);
    expect(targetGraphemes(60, 200, 300)).toBe(38);
  });

  it('never asks for a longer text than the one it has', () => {
    expect(targetGraphemes(30, 800, 600)).toBe(30);
    expect(targetGraphemes(30, 600, 600)).toBe(30);
  });

  it('asks for at least one grapheme when there is no room at all', () => {
    expect(targetGraphemes(30, 0, 600)).toBe(1);
    expect(targetGraphemes(30, -20, 600)).toBe(1);
  });

  it('leaves the length alone when nothing is needed or there is nothing to shorten', () => {
    expect(targetGraphemes(30, 600, 0)).toBe(30);
    expect(targetGraphemes(0, 600, 780)).toBe(0);
  });
});

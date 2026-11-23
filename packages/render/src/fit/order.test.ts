import { describe, expect, it } from 'vitest';
import { SIZES, SIZE_NAMES } from '../sizes.ts';
import { fitOrder } from './order.ts';

// §08 The shortening loop: "the size with the least text room first, so a failure shows up early".
describe('fitOrder', () => {
  it('puts the size with the least text room first: landscape, square, story, portrait, pin', () => {
    expect(fitOrder(['pin', 'portrait', 'story', 'square', 'landscape'])).toEqual([
      'landscape',
      'square',
      'story',
      'portrait',
      'pin',
    ]);
  });

  it('orders by the text area (the page minus its margins), not by the page', () => {
    const area = (name: (typeof SIZE_NAMES)[number]) =>
      SIZES[name].textArea.width * SIZES[name].textArea.height;
    const ordered = fitOrder(SIZE_NAMES);
    expect(ordered.map(area)).toEqual([...ordered.map(area)].sort((a, b) => a - b));
  });

  it('gives the same order whatever order the sizes came in, and lists each size once', () => {
    expect(fitOrder(['portrait', 'story', 'portrait'])).toEqual(['story', 'portrait']);
    expect(fitOrder(['story', 'portrait'])).toEqual(fitOrder(['portrait', 'story']));
  });

  it('does not change the list it is given, and handles none', () => {
    const sizes = ['pin', 'square'] as const;
    fitOrder(sizes);
    expect(sizes).toEqual(['pin', 'square']);
    expect(fitOrder([])).toEqual([]);
  });
});

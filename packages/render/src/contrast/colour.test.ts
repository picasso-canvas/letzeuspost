import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex, relativeLuminance, toHex } from './colour.ts';

describe('contrastRatio (WCAG 2.x)', () => {
  it('is 21:1 for black on white and 1:1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#e4572e', '#e4572e')).toBeCloseTo(1, 5);
  });

  it('does not depend on the order of the two colours', () => {
    expect(contrastRatio('#1b1b1b', '#fff8f0')).toBe(contrastRatio('#fff8f0', '#1b1b1b'));
  });

  it('puts #767676 just over 4.5:1 on white and #777777 just under (the well-known AA edge)', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('reads upper- and lower-case hex alike', () => {
    expect(contrastRatio('#AABBCC', '#ffffff')).toBe(contrastRatio('#aabbcc', '#ffffff'));
  });

  it('refuses anything but a six-digit hex colour', () => {
    expect(() => contrastRatio('#fff', '#000000')).toThrow();
    expect(() => contrastRatio('red', '#000000')).toThrow();
    expect(() => contrastRatio('#12345g', '#000000')).toThrow();
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white, and weights green most (Rec. 709)', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 4);
    expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 4);
    expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 4);
  });
});

describe('parseHex and toHex', () => {
  it('round-trip, and write lower-case, clamped and rounded', () => {
    expect(toHex(parseHex('#A1B2C3'))).toBe('#a1b2c3');
    expect(toHex([300, -4, 127.6])).toBe('#ff0080');
  });
});

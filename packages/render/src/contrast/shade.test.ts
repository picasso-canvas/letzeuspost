import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex } from './colour.ts';
import { shadeToPass } from './shade.ts';

/** Hue in degrees, 0–360, of a `#rrggbb` colour. */
function hue(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe('shadeToPass', () => {
  it('returns the colour itself when it already passes', () => {
    expect(shadeToPass('#1B1B1B', '#ffffff', 4.5)).toBe('#1b1b1b');
  });

  it('darkens light grey on white to the nearest grey that reaches 4.5:1', () => {
    expect(shadeToPass('#cccccc', '#ffffff', 4.5)).toBe('#767676');
  });

  it('goes lighter when the background is dark', () => {
    const shaded = shadeToPass('#3a4a6a', '#101820', 4.5);
    expect(shaded).not.toBeNull();
    expect(contrastRatio(shaded ?? '', '#101820')).toBeGreaterThanOrEqual(4.5);
    expect(parseHex(shaded ?? '')[2]).toBeGreaterThan(parseHex('#3a4a6a')[2]);
  });

  it('keeps the hue of a pale accent and stops at the first shade that passes', () => {
    const shaded = shadeToPass('#ffe08a', '#ffffff', 4.5);
    expect(shaded).not.toBeNull();
    expect(contrastRatio(shaded ?? '', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(hue(shaded ?? '') - hue('#ffe08a'))).toBeLessThan(3);
    // Not darkened more than it must be: the shade is not near black.
    expect(contrastRatio(shaded ?? '', '#ffffff')).toBeLessThan(5);
  });

  it('uses the 3:1 limit for large text', () => {
    const shaded = shadeToPass('#cccccc', '#ffffff', 3);
    expect(shaded).toBe('#949494');
  });

  it('gives null when no shade of the colour can reach the limit', () => {
    expect(shadeToPass('#777777', '#777777', 21)).toBeNull();
  });
});

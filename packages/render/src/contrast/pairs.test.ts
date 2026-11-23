import { describe, expect, it } from 'vitest';
import { testKit } from '../page/test-fixtures.ts';
import { contrastRatio } from './colour.ts';
import { checkPairs, pairsFor, registerPairs, resolveColour, type TextPair } from './pairs.ts';

const kit = testKit(); // ink #1b1b1b on background #fff8f0; extras ['#ffc914']

const body: TextPair = { name: 'body on background', text: 'ink', on: 'background', px: 32 };

describe('checkPairs', () => {
  it('gives the ratio, the limit and whether the pair passes, from the tokens', () => {
    const [result] = checkPairs(kit, 'clean', [body]);
    expect(result).toMatchObject({
      name: 'body on background',
      look: 'clean',
      text: '#1b1b1b',
      on: '#fff8f0',
      photo: false,
      limit: 4.5,
      passes: true,
    });
    expect(result?.ratio).toBeCloseTo(contrastRatio('#1b1b1b', '#fff8f0'), 10);
  });

  it('returns one result per pair, in order', () => {
    const results = checkPairs(kit, 'bold', [
      body,
      { name: 'accent text', text: 'accent', on: 'background', px: 32 },
    ]);
    expect(results.map((r) => r.name)).toEqual(['body on background', 'accent text']);
  });

  it('fails a pair under 4.5:1 and passes it at exactly the edge cases of the limit', () => {
    const grey = { hex: '#777777' } as const; // 4.48:1 on white
    const [fail] = checkPairs(kit, 'clean', [
      { name: 'grey', text: grey, on: { hex: '#ffffff' }, px: 32 },
    ]);
    expect(fail?.passes).toBe(false);
    const [pass] = checkPairs(kit, 'clean', [
      { name: 'grey', text: { hex: '#767676' }, on: { hex: '#ffffff' }, px: 32 },
    ]);
    expect(pass?.passes).toBe(true);
  });

  it('asks 3:1 only of a headline of 48 px or more at 1080 width', () => {
    const grey = { name: 'h', text: { hex: '#949494' }, on: { hex: '#ffffff' } } as const; // 3.03:1
    const limit = (pair: TextPair) => checkPairs(kit, 'bold', [pair])[0]?.limit;
    expect(limit({ ...grey, px: 48, headline: true })).toBe(3);
    expect(limit({ ...grey, px: 47, headline: true })).toBe(4.5);
    expect(limit({ ...grey, px: 96 })).toBe(4.5); // big, but not a headline
    // The size is judged at 1080 width: 52 px on a 1200 page is 46.8 px; 45 px on a 1000 page is 48.6 px.
    expect(limit({ ...grey, px: 52, headline: true, width: 1200 })).toBe(4.5);
    expect(limit({ ...grey, px: 45, headline: true, width: 1000 })).toBe(3);
  });

  it('judges text on a photo behind its scrim, at the worse of the brightest and darkest photo', () => {
    const [white] = checkPairs(kit, 'clean', [
      { name: 'on photo', text: { hex: '#ffffff' }, on: { photo: true }, px: 40 },
    ]);
    expect(white).toMatchObject({ photo: true, on: '#666666', passes: true });
    expect(white?.ratio).toBeGreaterThanOrEqual(4.5);
    const [mid] = checkPairs(kit, 'clean', [
      { name: 'on photo', text: { hex: '#808080' }, on: { photo: true }, px: 40 },
    ]);
    expect(mid?.passes).toBe(false);
  });

  it('reads the extras of the kit by position and refuses one that is not there', () => {
    expect(resolveColour(kit, { extra: 0 })).toBe('#ffc914');
    expect(() => resolveColour(kit, { extra: 1 })).toThrow();
    expect(resolveColour(testKit({}), 'primary')).toBe('#e4572e');
  });
});

describe('the layout registry', () => {
  it('asks a layout for its pairs with the kit, the look and the size, and adds the page width', () => {
    registerPairs('quote', ({ kit: k, look, size }) => [
      {
        name: `${look} ${size} quote`,
        text: 'ink',
        on: 'background',
        px: k.colors.ink === '#1b1b1b' ? 40 : 0,
      },
    ]);
    expect(pairsFor('quote', kit, 'editorial', 'landscape')).toEqual([
      {
        name: 'quote: editorial landscape quote',
        text: 'ink',
        on: 'background',
        px: 40,
        width: 1200,
      },
    ]);
    expect(pairsFor('quote', kit, 'bold', 'pin')[0]?.width).toBe(1000);
  });

  it('refuses to register a layout twice, and refuses to check one that declared nothing', () => {
    registerPairs('stat', () => []);
    expect(() => {
      registerPairs('stat', () => []);
    }).toThrow(/already/);
    expect(() => pairsFor('offer', kit, 'bold', 'square')).toThrow(/offer/);
  });
});

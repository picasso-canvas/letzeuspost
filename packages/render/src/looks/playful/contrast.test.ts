import { describe, expect, it } from 'vitest';
import { checkPairs } from '../../contrast/pairs.ts';
import type { RenderKit } from '../../kit.ts';
import { testKit } from '../../page/test-fixtures.ts';
import { SIZE_NAMES, SIZES, SMALL_PRINT_PX } from '../../sizes.ts';
import { playfulContrast, playfulPairs, playfulTints } from './contrast.ts';
import { PLAYFUL_FONTS } from './index.ts';

// The Playful look's text pairs (§07 Contrast, §08: each text/background pair the look draws, at its real size), on a
// sample kit of our own: "Sunny Lane Play Café", a made-up café for families with made-up colours.

const SAMPLE: RenderKit = testKit({
  colors: {
    primary: '#7a2e8e',
    accent: '#ffc845',
    background: '#fff4e0',
    ink: '#2b1d3a',
    extras: [],
  },
  fonts: PLAYFUL_FONTS,
});

const withColours = (colours: Partial<RenderKit['colors']>): RenderKit => ({
  ...SAMPLE,
  colors: { ...SAMPLE.colors, ...colours },
});

/** Every pair, at every size, that still fails on `kit`. */
const failingEverywhere = (kit: RenderKit) =>
  SIZE_NAMES.flatMap((size) =>
    checkPairs(kit, 'playful', playfulPairs(kit, size)).filter((result) => !result.passes),
  );

describe('the Playful badge', () => {
  it('is the accent mixed half into the background, the way the browser does (color-mix in srgb)', () => {
    // #ffc845 and #fff4e0 half and half: (255, 222, 146.5) → #ffde93
    expect(playfulTints(SAMPLE).badge).toBe('#ffde93');
    expect(playfulTints(withColours({ accent: '#fff4e0' })).badge).toBe('#fff4e0');
  });
});

describe("the Playful look's text pairs", () => {
  it.each(SIZE_NAMES)('%s: every text the look draws, on everything it can sit on', (size) => {
    const names = playfulPairs(SAMPLE, size).map((pair) => pair.name);
    const texts = [
      'title',
      'title highlight',
      'kicker',
      'kicker highlight',
      'body',
      'body highlight',
      'small print',
    ];
    for (const text of texts)
      for (const on of ['ground', 'badge']) expect(names).toContain(`playful: ${text} on ${on}`);
    for (const text of ['title highlight', 'kicker highlight', 'body highlight'])
      expect(names).toContain(`playful: ${text} on pill`);
    expect(names).toHaveLength(texts.length * 2 + 3);
  });

  it.each(SIZE_NAMES)(
    '%s: at their real sizes, the smallest the fit check can set them',
    (size) => {
      const pairs = playfulPairs(SAMPLE, size);
      const px = (name: string) => pairs.find((pair) => pair.name === `playful: ${name}`)?.px;
      expect(px('small print on ground')).toBe(SMALL_PRINT_PX);
      expect(px('body on ground')).toBeGreaterThanOrEqual(SIZES[size].bodyFloor);
      expect(px('title on ground')).toBeGreaterThan(px('kicker on ground') ?? Infinity);
      expect(px('title highlight on pill')).toBe(px('title on ground'));
      for (const pair of pairs) expect(pair.width).toBe(SIZES[size].width);
      expect(pairs.filter((pair) => pair.headline === true).map((pair) => pair.name)).toEqual([
        'playful: title on ground',
        'playful: title on badge',
        'playful: title highlight on ground',
        'playful: title highlight on badge',
        'playful: title highlight on pill',
      ]);
    },
  );

  it('judges the pill as ink on the accent, and the ground as the background itself', () => {
    const results = checkPairs(SAMPLE, 'playful', playfulPairs(SAMPLE, 'portrait'));
    const of = (name: string) => results.find((result) => result.name === `playful: ${name}`);
    expect(of('body highlight on pill')).toMatchObject({ text: '#2b1d3a', on: '#ffc845' });
    expect(of('kicker on ground')).toMatchObject({ text: '#7a2e8e', on: '#fff4e0' });
    expect(of('kicker on badge')).toMatchObject({ text: '#7a2e8e', on: '#ffde93' });
  });

  it('the sample kit passes every pair, at every size, as it is', () => {
    expect(failingEverywhere(SAMPLE)).toEqual([]);
    expect(playfulContrast(SAMPLE)).toEqual({ kit: SAMPLE, warnings: [], failures: [] });
  });
});

describe('a bad palette in the Playful look', () => {
  it('a pale primary fails as it is, is shaded darker to pass, and the editor is told from what to what', () => {
    const pale = withColours({ primary: '#f4a3c0' });
    const before = checkPairs(pale, 'playful', playfulPairs(pale, 'portrait'));
    expect(before.find((r) => r.name === 'playful: kicker on ground')?.passes).toBe(false);

    const result = playfulContrast(pale);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    const [warning] = result.warnings;
    expect(warning).toMatchObject({ colour: 'primary', look: 'playful', from: '#f4a3c0' });
    expect(warning?.to).toBe(result.kit.colors.primary);
    expect(warning?.pairs).toContain('playful: kicker on ground');
    expect(parseInt(result.kit.colors.primary.slice(1, 3), 16)).toBeLessThan(0xf4);
    expect(result.kit.colors).toEqual({ ...pale.colors, primary: result.kit.colors.primary });
    expect(pale.colors.primary).toBe('#f4a3c0'); // the kit passed in is not changed
    expect(failingEverywhere(result.kit)).toEqual([]);
  });

  it('a dark accent under ink fails as a pill, and the accent is shaded lighter, not the ink', () => {
    const dark = withColours({ accent: '#3b2a8f' });
    const before = checkPairs(dark, 'playful', playfulPairs(dark, 'portrait'));
    expect(before.find((r) => r.name === 'playful: body highlight on pill')?.passes).toBe(false);

    const result = playfulContrast(dark);
    expect(result.failures).toEqual([]);
    expect(result.warnings.map((warning) => warning.colour)).toEqual(['accent']);
    expect(result.warnings[0]).toMatchObject({ look: 'playful', from: '#3b2a8f' });
    expect(result.warnings[0]?.pairs).toContain('playful: body highlight on pill');
    expect(result.kit.colors.ink).toBe(SAMPLE.colors.ink);
    expect(result.kit.colors.accent).not.toBe('#3b2a8f');
    expect(failingEverywhere(result.kit)).toEqual([]);
  });

  it('never calls a palette fixed when it is not: every pair still failing is a failure', () => {
    // Mid-grey everything: shading moves what it can, and whatever no shade fixes is reported
    const grey = withColours({
      ink: '#808080',
      background: '#808080',
      primary: '#808080',
      accent: '#808080',
    });
    const result = playfulContrast(grey);
    expect(result.warnings.length).toBeGreaterThan(0);
    const stillFailing = new Set(failingEverywhere(result.kit).map((r) => r.name));
    expect(new Set(result.failures.map((r) => r.name))).toEqual(stillFailing);
  });
});

import { describe, expect, it } from 'vitest';
import { checkPairs } from '../../contrast/pairs.ts';
import { K_MIN } from '../../fit/report.ts';
import type { RenderKit } from '../../kit.ts';
import { testKit } from '../../page/test-fixtures.ts';
import { SIZE_NAMES, SIZES, SMALL_PRINT_PX } from '../../sizes.ts';
import { cleanContrast, cleanPairs, cleanTints } from './contrast.ts';
import { CLEAN_FONTS } from './index.ts';

// The Clean look's text pairs (§07 Contrast, §08: each text/background pair the look draws, at its real size), on a
// sample kit of our own: "Stillwater Physio", a made-up practice with made-up colours.

const SAMPLE: RenderKit = testKit({
  colors: {
    primary: '#1e6b74',
    accent: '#f2a65a',
    background: '#ffffff',
    ink: '#1d2b36',
    extras: [],
  },
  fonts: CLEAN_FONTS,
});

/** The same practice with a pale mint primary that can't carry text on its own tint. */
const PALE: RenderKit = { ...SAMPLE, colors: { ...SAMPLE.colors, primary: '#8ad1c2' } };

describe('the Clean tints', () => {
  it('mixes the primary into the background the way the browser does (color-mix in srgb)', () => {
    // #1e6b74 = (30, 107, 116); 6% of it into white: 0.06 × 30 + 0.94 × 255 = 241.5 → 242 (f2), and so on
    expect(cleanTints(SAMPLE).ground).toBe('#f2f6f7');
    expect(cleanTints({ ...SAMPLE, colors: { ...SAMPLE.colors, primary: '#ffffff' } })).toEqual({
      ground: '#ffffff',
      shape: '#ffffff',
      pill: '#ffffff',
    });
  });

  it('goes deeper from the ground to the shape to the pill', () => {
    const { ground, shape, pill } = cleanTints(SAMPLE);
    const red = (hex: string) => parseInt(hex.slice(1, 3), 16);
    expect(red(ground)).toBeGreaterThan(red(shape));
    expect(red(shape)).toBeGreaterThan(red(pill));
  });
});

describe("the Clean look's text pairs", () => {
  it.each(SIZE_NAMES)('%s: every text the look draws, on every ground it can sit on', (size) => {
    const names = cleanPairs(SAMPLE, size).map((pair) => pair.name);
    for (const text of ['title', 'title highlight', 'kicker', 'body', 'body highlight', 'small print'])
      for (const on of ['ground', 'shape'])
        expect(names).toContain(`clean: ${text} on ${on}`);
    expect(names).toContain('clean: title highlight on pill');
    expect(names).toContain('clean: body highlight on pill');
  });

  it.each(SIZE_NAMES)('%s: at their real sizes, the smallest the fit check can set them', (size) => {
    const pairs = cleanPairs(SAMPLE, size);
    const px = (name: string) => pairs.find((pair) => pair.name === `clean: ${name}`)?.px;
    expect(px('small print on ground')).toBe(SMALL_PRINT_PX);
    expect(px('body on ground')).toBeGreaterThanOrEqual(SIZES[size].bodyFloor);
    expect(px('title on ground')).toBeGreaterThan(px('kicker on ground') ?? Infinity);
    for (const pair of pairs) expect(pair.width).toBe(SIZES[size].width);
    // The title is the headline; the rest is text
    expect(pairs.filter((pair) => pair.headline === true).map((pair) => pair.name)).toEqual([
      'clean: title on ground',
      'clean: title on shape',
      'clean: title highlight on ground',
      'clean: title highlight on shape',
      'clean: title highlight on pill',
    ]);
  });

  it('holds a title to 3:1 where it stays 48 px at 1080 even at 85%, and to 4.5:1 on landscape where it does not', () => {
    const limit = (size: (typeof SIZE_NAMES)[number]) =>
      checkPairs(SAMPLE, 'clean', cleanPairs(SAMPLE, size)).find(
        (result) => result.name === 'clean: title on ground',
      )?.limit;
    expect(limit('portrait')).toBe(3);
    expect(limit('story')).toBe(3);
    // 60 px × 0.85 = 51 px on a 1200 px page is 45.9 px at 1080
    expect(K_MIN).toBe(0.85);
    expect(limit('landscape')).toBe(4.5);
  });

  it.each(SIZE_NAMES)('%s: the sample kit passes every pair as it is', (size) => {
    const failing = checkPairs(SAMPLE, 'clean', cleanPairs(SAMPLE, size)).filter(
      (result) => !result.passes,
    );
    expect(failing).toEqual([]);
    expect(cleanContrast(SAMPLE)).toEqual({ kit: SAMPLE, warnings: [], failures: [] });
  });
});

describe('a bad palette in the Clean look', () => {
  it('fails as it is: pale mint text on its own tint', () => {
    const results = checkPairs(PALE, 'clean', cleanPairs(PALE, 'portrait'));
    expect(results.find((r) => r.name === 'clean: kicker on ground')?.passes).toBe(false);
  });

  it('is shaded to pass and warns: the primary goes darker, and the editor is told from what to what', () => {
    const result = cleanContrast(PALE);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    const [warning] = result.warnings;
    expect(warning).toMatchObject({ colour: 'primary', look: 'clean', from: '#8ad1c2' });
    expect(warning?.to).toBe(result.kit.colors.primary);
    expect(warning?.pairs).toContain('clean: kicker on ground');
    // Darker, and the rest of the kit as it was; the kit passed in is not changed
    expect(parseInt(result.kit.colors.primary.slice(1, 3), 16)).toBeLessThan(0x8a);
    expect(result.kit.colors).toEqual({ ...PALE.colors, primary: result.kit.colors.primary });
    expect(PALE.colors.primary).toBe('#8ad1c2');
  });

  it.each(SIZE_NAMES)(
    '%s: the shaded kit passes on the tints the browser mixes from the shaded primary',
    (size) => {
      const { kit } = cleanContrast(PALE);
      const failing = checkPairs(kit, 'clean', cleanPairs(kit, size)).filter((r) => !r.passes);
      expect(failing).toEqual([]);
    },
  );

  it('never calls a palette fixed when it is not: every pair still failing is a failure', () => {
    // Mid-grey everything: shading moves the ink and the primary, and whatever no shade fixes is reported
    const grey: RenderKit = {
      ...SAMPLE,
      colors: { ...SAMPLE.colors, ink: '#808080', background: '#808080', primary: '#808080' },
    };
    const result = cleanContrast(grey);
    expect(result.warnings.length).toBeGreaterThan(0);
    const stillFailing = new Set(
      SIZE_NAMES.flatMap((size) =>
        checkPairs(result.kit, 'clean', cleanPairs(result.kit, size))
          .filter((r) => !r.passes)
          .map((r) => r.name),
      ),
    );
    expect(new Set(result.failures.map((r) => r.name))).toEqual(stillFailing);
  });
});

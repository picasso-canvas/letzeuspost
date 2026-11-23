import { describe, expect, it } from 'vitest';
import type { RenderKit } from '../kit.ts';
import { testKit } from '../page/test-fixtures.ts';
import { applyContrast } from './apply.ts';
import { checkPairs, registerPairs, type TextPair } from './pairs.ts';

const withColors = (colors: Partial<RenderKit['colors']>): RenderKit => {
  const base = testKit();
  return { ...base, colors: { ...base.colors, ...colors } };
};

const body: TextPair = { name: 'body on background', text: 'ink', on: 'background', px: 32 };
const headline: TextPair = {
  name: 'headline in primary',
  text: 'primary',
  on: 'background',
  px: 72,
  headline: true,
};
const allPass = (kit: RenderKit, pairs: TextPair[]) =>
  checkPairs(kit, 'clean', pairs).every((r) => r.passes);

describe('applyContrast', () => {
  it('returns a good palette unchanged: the same kit, no warnings', () => {
    const kit = testKit(); // #e4572e as a 72 px headline reaches 3:1 on #fff8f0
    expect(allPass(kit, [body, headline])).toBe(true);
    const result = applyContrast(kit, 'clean', [body, headline]);
    expect(result.kit).toBe(kit);
    expect(result.warnings).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('shades light grey ink on a white background to a passing grey, and says so', () => {
    const kit = withColors({ ink: '#cccccc', background: '#ffffff' });
    expect(allPass(kit, [body])).toBe(false);
    const result = applyContrast(kit, 'bold', [body]);
    expect(result.kit.colors.ink).toBe('#767676');
    expect(allPass(result.kit, [body])).toBe(true);
    expect(result.warnings).toEqual([
      {
        colour: 'ink',
        look: 'bold',
        from: '#cccccc',
        to: '#767676',
        pairs: ['body on background'],
      },
    ]);
    expect(result.failures).toEqual([]);
  });

  it('shades a pale accent used as text, and leaves every other colour and the kit itself alone', () => {
    const kit = withColors({ accent: '#ffe08a', background: '#ffffff' });
    const accentText: TextPair = { name: 'accent text', text: 'accent', on: 'background', px: 32 };
    const result = applyContrast(kit, 'clean', [body, accentText]);
    expect(allPass(result.kit, [body, accentText])).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ colour: 'accent', from: '#ffe08a' });
    expect(result.warnings[0]?.to).toBe(result.kit.colors.accent);
    expect(result.kit.colors).toEqual({ ...kit.colors, accent: result.kit.colors.accent });
    expect(kit.colors.accent).toBe('#ffe08a'); // not changed in place
  });

  it('shades an extra colour by its position', () => {
    const kit = withColors({ extras: ['#1b1b1b', '#fff2a8'], background: '#ffffff' });
    const pair: TextPair = { name: 'extra text', text: { extra: 1 }, on: 'background', px: 32 };
    const result = applyContrast(kit, 'clean', [pair]);
    expect(result.warnings[0]?.colour).toBe('extras[1]');
    expect(result.kit.colors.extras[0]).toBe('#1b1b1b');
    expect(allPass(result.kit, [pair])).toBe(true);
  });

  it('shades the background colour when the text is a fixed one (white on a pale primary band)', () => {
    const kit = withColors({ primary: '#f0c030' });
    const band: TextPair = {
      name: 'white on the primary band',
      text: { hex: '#ffffff' },
      on: 'primary',
      px: 40,
    };
    const result = applyContrast(kit, 'bold', [band]);
    expect(result.warnings[0]).toMatchObject({ colour: 'primary', from: '#f0c030' });
    expect(allPass(result.kit, [band])).toBe(true);
  });

  it('fixes kit-coloured text on a photo, whatever the scrim ends up being', () => {
    const kit = withColors({ accent: '#808080' });
    const onPhoto: TextPair = {
      name: 'accent on photo',
      text: 'accent',
      on: { photo: true },
      px: 40,
    };
    const result = applyContrast(kit, 'playful', [onPhoto]);
    expect(allPass(result.kit, [onPhoto])).toBe(true);
    expect(result.warnings[0]?.colour).toBe('accent');
  });

  it('reports a failing pair that no kit colour can fix, and changes nothing', () => {
    const kit = testKit();
    const stuck: TextPair = {
      name: 'fixed grey on fixed grey',
      text: { hex: '#808080' },
      on: { hex: '#888888' },
      px: 32,
    };
    const result = applyContrast(kit, 'clean', [stuck]);
    expect(result.kit).toBe(kit);
    expect(result.warnings).toEqual([]);
    expect(result.failures.map((f) => f.name)).toEqual(['fixed grey on fixed grey']);
  });

  it('collects the pairs of one colour in a single warning, from the original to the final shade', () => {
    const kit = withColors({ ink: '#cccccc', background: '#ffffff' });
    const second: TextPair = { name: 'caption', text: 'ink', on: 'background', px: 28 };
    const { warnings } = applyContrast(kit, 'clean', [body, second]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.pairs).toEqual(['body on background', 'caption']);
  });

  it('without pairs, checks every registered layout at every size', () => {
    registerPairs('cta', ({ size }) => [
      { name: `button text at ${size}`, text: 'ink', on: 'background', px: 40 },
    ]);
    const kit = withColors({ ink: '#cccccc', background: '#ffffff' });
    const result = applyContrast(kit, 'clean');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.colour).toBe('ink');
    expect(result.warnings[0]?.pairs).toHaveLength(5);
    expect(result.warnings[0]?.pairs[0]).toBe('cta: button text at portrait');
  });
});

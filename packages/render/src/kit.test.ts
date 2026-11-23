import { describe, expect, it } from 'vitest';
import { LookDefinitionSchema, RenderKitSchema } from './kit.ts';
import { testKit } from './page/test-fixtures.ts';

describe('RenderKitSchema', () => {
  it('accepts what a brand kit gives the renderer', () => {
    expect(RenderKitSchema.safeParse(testKit()).success).toBe(true);
  });

  it('takes a mascot, but it is optional', () => {
    expect(RenderKitSchema.safeParse(testKit({ mascot: 'mascot_1' })).success).toBe(true);
    expect(RenderKitSchema.safeParse({ ...testKit(), mascot: undefined }).success).toBe(true);
  });

  it.each(['red', '#fff', '#12345g', 'url(x)', '#112233; } body { x: y', 'rgb(0,0,0)'])(
    'rejects the colour %s: colours are six-digit hex, since they go into CSS',
    (bad) => {
      const kit = testKit();
      expect(
        RenderKitSchema.safeParse({ ...kit, colors: { ...kit.colors, primary: bad } }).success,
      ).toBe(false);
    },
  );

  it('rejects a colour among the extras that is not hex', () => {
    const kit = testKit();
    expect(
      RenderKitSchema.safeParse({ ...kit, colors: { ...kit.colors, extras: ['nope'] } }).success,
    ).toBe(false);
  });

  it('takes font names from the font manifest only', () => {
    const kit = testKit();
    const unknown = {
      ...kit,
      fonts: { ...kit.fonts, en: { ...kit.fonts.en, body: 'Comic Sans' } },
    };
    expect(RenderKitSchema.safeParse(unknown).success).toBe(false);
  });

  it('takes a font only for a language the manifest sets it for', () => {
    const kit = testKit();
    // Nunito is an English font: it can't be the Bangla heading.
    const wrong = { ...kit, fonts: { ...kit.fonts, bn: { ...kit.fonts.bn, heading: 'Nunito' } } };
    expect(RenderKitSchema.safeParse(wrong).success).toBe(false);
  });

  it('takes logos and a mascot as asset keys, never as web addresses', () => {
    const kit = testKit();
    for (const bad of ['https://evil.test/logo.png', '//evil.test/x', 'a/b', '../x', '']) {
      expect(RenderKitSchema.safeParse({ ...kit, logo: { ...kit.logo, light: bad } }).success).toBe(
        false,
      );
    }
    expect(RenderKitSchema.safeParse({ ...kit, mascot: 'http://evil.test/m.png' }).success).toBe(
      false,
    );
  });

  it('rejects fields it does not know', () => {
    expect(RenderKitSchema.safeParse({ ...testKit(), extra: 1 }).success).toBe(false);
  });
});

describe('LookDefinitionSchema', () => {
  const look = {
    name: 'clean',
    version: 1,
    css: '.slide { color: red; }',
    tokens: { radius: '24px' },
  };

  it('accepts a look: name, version, CSS and tokens', () => {
    expect(LookDefinitionSchema.safeParse(look).success).toBe(true);
  });

  it('only takes the four look names', () => {
    expect(LookDefinitionSchema.safeParse({ ...look, name: 'neon' }).success).toBe(false);
  });

  it.each([
    '.a { filter: blur(2px); }',
    '.a { backdrop-filter: blur(2px); }',
    '.a { mix-blend-mode: multiply; }',
    '.a { background-blend-mode: multiply; }',
    '.a { FILTER : none }',
  ])('rejects CSS that is not print-safe: %s', (css) => {
    expect(LookDefinitionSchema.safeParse({ ...look, css }).success).toBe(false);
  });

  it('rejects CSS that could close its <style> element', () => {
    expect(
      LookDefinitionSchema.safeParse({ ...look, css: '</style><script>x</script>' }).success,
    ).toBe(false);
  });

  it('rejects a token with a name or value that is not plain CSS', () => {
    expect(LookDefinitionSchema.safeParse({ ...look, tokens: { 'a b': '1' } }).success).toBe(false);
    expect(LookDefinitionSchema.safeParse({ ...look, tokens: { a: '1; } x {' } }).success).toBe(
      false,
    );
  });

  it('needs a whole, positive version', () => {
    expect(LookDefinitionSchema.safeParse({ ...look, version: 0 }).success).toBe(false);
    expect(LookDefinitionSchema.safeParse({ ...look, version: 1.5 }).success).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { splitThemes } from './generate.ts';

const EXPORTED = `@theme {
  --color-background: #f7f6f4;
  --color-ring: #1c1a17;
  --color-background-dark: #11100e;
  --color-ring-dark: #f5b301;
  --font-body: "Inter";
  --radius-md: 8px;
}
`;

describe('splitThemes (#70)', () => {
  it('keeps the light tokens in the Tailwind theme and leaves the dark partners out of it', () => {
    const { theme } = splitThemes(EXPORTED);
    expect(theme).toContain('@theme {');
    expect(theme).toContain('  --color-background: #f7f6f4;');
    expect(theme).toContain('  --color-ring: #1c1a17;');
    expect(theme).toContain('  --font-body: "Inter";');
    expect(theme).toContain('  --radius-md: 8px;');
    expect(theme).not.toContain('-dark');
  });

  it('puts each dark partner under .dark, on its light name', () => {
    const { dark } = splitThemes(EXPORTED);
    expect(dark).toContain('.dark {');
    expect(dark).toContain('  --color-background: #11100e;');
    expect(dark).toContain('  --color-ring: #f5b301;');
    expect(dark).not.toContain('font');
  });

  it('marks both files as generated', () => {
    const { theme, dark } = splitThemes(EXPORTED);
    for (const css of [theme, dark]) expect(css).toMatch(/^\/\* Generated from DESIGN\.md/);
  });

  it('refuses a colour without its dark partner, and a dark partner without its light colour', () => {
    expect(() => splitThemes('@theme {\n  --color-card: #ffffff;\n}\n')).toThrow(
      /card has no dark partner/,
    );
    expect(() =>
      splitThemes(
        '@theme {\n  --color-card: #ffffff;\n  --color-card-dark: #191815;\n  --color-gold-dark: #f5b301;\n}\n',
      ),
    ).toThrow(/gold-dark has no light colour/);
  });

  it('refuses output it does not understand', () => {
    expect(() => splitThemes('--color-card: #ffffff;\n')).toThrow(/@theme/);
  });
});

describe('the committed tokens (#70)', () => {
  it('give every colour a dark value, ring included (ink in light mode, gold in dark)', () => {
    const theme = readFileSync(new URL('theme.css', import.meta.url), 'utf8');
    const dark = readFileSync(new URL('dark.css', import.meta.url), 'utf8');
    const names = (css: string) => [...css.matchAll(/--color-([\w-]+):/g)].map((m) => m[1]);
    expect(names(dark)).toEqual(names(theme));
    expect(theme).toContain('--color-ring: #1c1a17;');
    expect(dark).toContain('--color-ring: #f5b301;');
    expect(theme).toContain('--color-primary: #f5b301;');
  });
});

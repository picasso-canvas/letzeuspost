import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// base.css holds the design values DESIGN.md's format can't carry into its export (#70): the font stack, line
// heights, tabular numbers, the shadow and the motion. They come from the approved mockup's CSS and DESIGN.md's prose.
const base = readFileSync(new URL('base.css', import.meta.url), 'utf8');
const mockup = readFileSync(
  new URL('../../../../docs/design/mockups/v1/index.html', import.meta.url),
  'utf8',
);

/** The value of `--name` in the CSS block that starts at `selector`. */
function declared(css: string, selector: string, name: string): string {
  const start = css.indexOf(selector);
  const block = start === -1 ? '' : css.slice(start, css.indexOf('}', start));
  const value = new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
  // Missing on both sides would compare equal, so a missing value fails here.
  if (value === undefined) throw new Error(`no --${name} in ${selector}`);
  return value;
}

const mockupShadow = (selector: string) => declared(mockup, selector, 'shadow');

/** Prettier's spelling and the mockup's compare equal: quotes, spaces and leading zeros don't count. */
const norm = (value: string) =>
  value
    .replaceAll("'", '"')
    .replace(/\s+/g, '')
    .replace(/(?<![\d.])0\./g, '.');

describe('base.css (#70)', () => {
  it("uses the mockup's interface font stack, so a missing Inter falls back to a system sans", () => {
    expect(norm(declared(base, '@theme', 'font-sans'))).toBe(
      norm(declared(mockup, ':root {', 'ui')),
    );
  });

  it('gives body and meta text a 1.5 line height and the numbers style tabular figures', () => {
    expect(declared(base, '@theme', 'text-body--line-height')).toBe('1.5');
    expect(declared(base, '@theme', 'text-meta--line-height')).toBe('1.5');
    expect(norm(declared(base, '@theme', 'font-numbers--font-feature-settings'))).toBe('"tnum"');
  });

  it("lifts the frame and menus with the mockup's shadow, light and dark", () => {
    expect(norm(declared(base, '@theme', 'shadow-frame'))).toBe(norm(mockupShadow(':root {')));
    expect(norm(declared(base, '.dark', 'shadow-frame'))).toBe(
      norm(mockupShadow(':root[data-theme="dark"]')),
    );
  });

  it('times transitions at 150 ms (§05: 150–200 ms), and at none under reduced motion', () => {
    expect(declared(base, '@theme', 'default-transition-duration')).toBe('150ms');
    expect(
      declared(base, '@media (prefers-reduced-motion: reduce)', 'default-transition-duration'),
    ).toBe('0ms');
  });
});

import { describe, expect, it } from 'vitest';
import { FONT_MANIFEST } from '../../fonts/library.ts';
import { BANGLA_LINE_HEIGHT_MIN } from '../../fonts/manifest.ts';
import { LookDefinitionSchema } from '../../kit.ts';
import { buildSlide } from '../../page/build-slide.ts';
import { getLook } from '../../page/looks.ts';
import { testBanglaPost, testKit, testPost } from '../../page/test-fixtures.ts';
import { CLEAN_CSS } from './css.ts';
import { CLEAN_FONTS, CLEAN_LOOK } from './index.ts';
import { CLEAN_TOKENS } from './tokens.ts';

// The Clean look as the renderer sees it (§07 The four looks, §08 Looks in the renderer and Fonts). Importing
// `./index.ts` registers it, as loading `looks/index.ts` does in the worker and the editor.

const styleOf = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';

/** The page of the test post's first slide in the Clean look, with the look's own font pair. */
function page(lang: 'en' | 'bn'): string {
  const post = lang === 'en' ? testPost() : testBanglaPost();
  const slide = post.slides[0];
  if (slide === undefined) throw new Error('no slide');
  return buildSlide(post, slide, 'portrait', testKit({ fonts: CLEAN_FONTS }));
}

/** The declarations of every rule whose selector list has a selector that ends in `.cls` or `cls`. */
function declarationsFor(css: string, target: RegExp): string {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, list]) => (list ?? '').split(',').some((selector) => target.test(selector.trim())))
    .map(([, , body]) => body)
    .join(';');
}

describe('the Clean look is registered with the renderer', () => {
  it('is a valid LookDefinition named clean, with a version', () => {
    expect(LookDefinitionSchema.parse(CLEAN_LOOK)).toEqual(CLEAN_LOOK);
    expect(CLEAN_LOOK.name).toBe('clean');
    expect(Number.isInteger(CLEAN_LOOK.version) && CLEAN_LOOK.version > 0).toBe(true);
  });

  it('is the look the renderer finds for "clean", with its own CSS and tokens', () => {
    expect(getLook('clean')).toEqual(CLEAN_LOOK);
    expect(CLEAN_LOOK.css).toBe(CLEAN_CSS);
    expect(CLEAN_LOOK.tokens).toEqual(CLEAN_TOKENS);
  });

  it("puts its CSS after the shared base, and its tokens as CSS variables, on a post's page", () => {
    const style = styleOf(page('en'));
    expect(style.endsWith(CLEAN_CSS)).toBe(true);
    for (const [name, value] of Object.entries(CLEAN_TOKENS)) {
      expect(style).toContain(`--${name}: ${value};`);
    }
  });
});

describe('the Clean fonts', () => {
  it("are the manifest's pair for the look: Nunito, and Hind Siliguri for Bangla", () => {
    expect(CLEAN_FONTS).toEqual(FONT_MANIFEST.looks.clean);
    expect(CLEAN_FONTS).toEqual({
      en: { heading: 'Nunito', body: 'Nunito' },
      bn: { heading: 'Hind Siliguri', body: 'Hind Siliguri' },
    });
  });

  it('set an English page in Nunito and a Bangla page in Hind Siliguri', () => {
    const en = styleOf(page('en'));
    expect(en).toMatch(/--font-heading: 'Nunito';/);
    expect(en).toMatch(/--font-body: 'Nunito';/);
    const bn = styleOf(page('bn'));
    expect(bn).toMatch(/--font-heading: 'Hind Siliguri';/);
    expect(bn).toMatch(/--font-body: 'Hind Siliguri';/);
    expect(bn).not.toContain("'Nunito'");
  });

  it("never names a font family of its own: the page's fonts are the kit's, loaded and checked", () => {
    expect(CLEAN_CSS).not.toMatch(/font-family\s*:\s*(?!var\()/);
  });
});

/** What is not print-safe in a piece of CSS (§08): filters, backdrop blur, blend modes and anything remote. */
function printSafetyProblems(css: string): string[] {
  const checks: [string, RegExp][] = [
    ['filter', /(^|[^-\w])filter\s*:/i],
    ['backdrop-filter', /backdrop-filter/i],
    ['blend mode', /blend-mode/i],
    ['remote url', /url\(\s*['"]?\s*(https?:|\/\/|ftp:|data:)/i],
    ['@import', /@import/i],
  ];
  return checks.filter(([, pattern]) => pattern.test(css)).map(([name]) => name);
}

describe('the Clean CSS is print-safe', () => {
  it('has no filter, backdrop-filter, blend mode, remote url or @import, in its CSS or its tokens', () => {
    expect(printSafetyProblems(CLEAN_CSS)).toEqual([]);
    expect(printSafetyProblems(Object.values(CLEAN_TOKENS).join(';'))).toEqual([]);
    expect(CLEAN_CSS).not.toMatch(/url\(/i); // and no image at all yet: textures would be asset tiles
  });

  it.each([
    ['.a { filter: blur(2px) }', 'filter'],
    ['.a { backdrop-filter: blur(4px) }', 'backdrop-filter'],
    ['.a { mix-blend-mode: multiply }', 'blend mode'],
    ['.a { background: url(https://example.com/tile.png) }', 'remote url'],
    ['.a { background: url("//cdn.example.com/tile.png") }', 'remote url'],
    ['@import "https://example.com/more.css";', '@import'],
  ])('the check catches %s', (css, problem) => {
    expect(printSafetyProblems(css)).toContain(problem);
  });
});

describe('Bangla in the Clean look (§07, §08)', () => {
  it('keeps at least the Bangla line-heights in the font manifest', () => {
    const hind = FONT_MANIFEST.fonts.find((font) => font.family === 'Hind Siliguri');
    const style = styleOf(page('bn'));
    const body = Number(/--lh-body: ([\d.]+);/.exec(style)?.[1]);
    const heading = Number(/--lh-heading: ([\d.]+);/.exec(style)?.[1]);
    expect(body).toBeGreaterThanOrEqual(hind?.banglaLineHeight?.body ?? 99);
    expect(heading).toBeGreaterThanOrEqual(hind?.banglaLineHeight?.heading ?? 99);
    expect(body).toBeGreaterThanOrEqual(BANGLA_LINE_HEIGHT_MIN.body);
    expect(heading).toBeGreaterThanOrEqual(BANGLA_LINE_HEIGHT_MIN.heading);
  });

  it('never sets a line-height of its own, nor the line-height variables', () => {
    expect(CLEAN_CSS).not.toMatch(/line-height\s*:/i);
    expect(CLEAN_CSS).not.toMatch(/--lh-/);
  });

  it('keeps headings balanced: no rule changes how the title wraps', () => {
    expect(declarationsFor(CLEAN_CSS, /\.title$/)).not.toMatch(/text-wrap|white-space/);
    expect(CLEAN_CSS).not.toMatch(/text-wrap\s*:\s*(?!balance|pretty)/);
  });

  it('has no letter-spacing, uppercase or italic', () => {
    expect(CLEAN_CSS).not.toMatch(/letter-spacing|word-spacing/i);
    expect(CLEAN_CSS).not.toMatch(/uppercase|capitalize|text-transform/i);
    expect(CLEAN_CSS).not.toMatch(/italic|oblique/i);
  });
});

describe('what the look may not change (§07: layout geometry, type scale, safe zones)', () => {
  it('sets no font size, and none of the size, margin or scale variables', () => {
    expect(CLEAN_CSS).not.toMatch(/font-size\s*:/i);
    expect(CLEAN_CSS).not.toMatch(
      /--(w|h|mt|mr|mb|ml|k|body-floor|title-size|body-size|kicker-size|gap|column-gap)\s*:/,
    );
  });

  it('gives the slide, the text area and the text blocks no padding, margin, width or height', () => {
    for (const block of [
      /\.slide$/,
      /\.text-area$/,
      /\.col$/,
      /\.title$/,
      /\.body$/,
      /\.kicker$/,
    ]) {
      expect(declarationsFor(CLEAN_CSS, block)).not.toMatch(
        /(^|[;\s])(padding|margin|width|height|gap|flex)[\w-]*\s*:/,
      );
    }
  });
});

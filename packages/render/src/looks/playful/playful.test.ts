import { describe, expect, it } from 'vitest';
import { FONT_MANIFEST } from '../../fonts/library.ts';
import { BANGLA_LINE_HEIGHT_MIN } from '../../fonts/manifest.ts';
import { LookDefinitionSchema } from '../../kit.ts';
import { sizeCss } from '../../page/base-css.ts';
import { buildSlide } from '../../page/build-slide.ts';
import { getLook } from '../../page/looks.ts';
import type { Switches } from '../../page/switches.ts';
import { testBanglaPost, testKit, testPost } from '../../page/test-fixtures.ts';
import { SIZE_NAMES, SIZES, type SizeName } from '../../sizes.ts';
import { PLAYFUL_CSS } from './css.ts';
import { PLAYFUL_FONTS, PLAYFUL_LOOK } from './index.ts';
import { PLAYFUL_TOKENS } from './tokens.ts';

// The Playful look as the renderer sees it (§07 The four looks, §08 Looks in the renderer and Fonts). Importing
// `./index.ts` registers it, as loading `looks/index.ts` does in the worker and the editor.

const styleOf = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';

/** The page of the test post's first slide in the Playful look, with the look's own font pair. */
function page(lang: 'en' | 'bn', switches: Partial<Switches> = {}): string {
  const base = lang === 'en' ? testPost() : testBanglaPost();
  const post = { ...base, look: { name: 'playful' as const, switches } };
  const slide = post.slides[0];
  if (slide === undefined) throw new Error('no slide');
  return buildSlide(post, slide, 'portrait', testKit({ fonts: PLAYFUL_FONTS }));
}

/** The rules of a piece of CSS: each selector list, split, with its declarations. */
const rules = (css: string): { selectors: string[]; body: string }[] =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, list, body]) => ({
    selectors: (list ?? '').split(',').map((selector) => selector.trim()),
    body: body ?? '',
  }));

/** The declarations of every rule whose selector list has a selector that matches `target` (`/\.title$/`). */
const declarationsFor = (css: string, target: RegExp): string =>
  rules(css)
    .filter(({ selectors }) => selectors.some((selector) => target.test(selector)))
    .map(({ body }) => body)
    .join(';');

/** The value of `property` in the declarations (the last one wins, as in CSS). */
const valueOf = (declarations: string, property: string): string | undefined =>
  [...declarations.matchAll(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`, 'g'))]
    .map(([, value]) => value?.trim())
    .at(-1);

describe('the Playful look is registered with the renderer', () => {
  it('is a valid LookDefinition named playful, with a version', () => {
    expect(LookDefinitionSchema.parse(PLAYFUL_LOOK)).toEqual(PLAYFUL_LOOK);
    expect(PLAYFUL_LOOK.name).toBe('playful');
    expect(Number.isInteger(PLAYFUL_LOOK.version) && PLAYFUL_LOOK.version > 0).toBe(true);
  });

  it('is the look the renderer finds for "playful", with its own CSS and tokens', () => {
    expect(getLook('playful')).toEqual(PLAYFUL_LOOK);
    expect(PLAYFUL_LOOK.css).toBe(PLAYFUL_CSS);
    expect(PLAYFUL_LOOK.tokens).toEqual(PLAYFUL_TOKENS);
    expect(PLAYFUL_CSS).toContain('.look-playful');
  });

  it("puts its CSS after the shared base, and its tokens as CSS variables, on a post's page", () => {
    const style = styleOf(page('en'));
    expect(style.endsWith(PLAYFUL_CSS)).toBe(true);
    expect(Object.keys(PLAYFUL_TOKENS).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(PLAYFUL_TOKENS)) {
      expect(style).toContain(`--${name}: ${value};`);
    }
  });
});

describe('the Playful fonts', () => {
  it("are the manifest's pair for the look: Bagel Fat One headings on Baloo 2, and Baloo Da 2 for Bangla", () => {
    expect(PLAYFUL_FONTS).toEqual(FONT_MANIFEST.looks.playful);
    expect(PLAYFUL_FONTS).toEqual({
      en: { heading: 'Bagel Fat One', body: 'Baloo 2' },
      bn: { heading: 'Baloo Da 2', body: 'Baloo Da 2' },
    });
  });

  it('set an English page in Bagel Fat One and Baloo 2, and a Bangla page in Baloo Da 2', () => {
    const en = styleOf(page('en'));
    expect(en).toMatch(/--font-heading: 'Bagel Fat One';/);
    expect(en).toMatch(/--font-body: 'Baloo 2';/);
    const bn = styleOf(page('bn'));
    expect(bn).toMatch(/--font-heading: 'Baloo Da 2';/);
    expect(bn).toMatch(/--font-body: 'Baloo Da 2';/);
    expect(bn).not.toContain("'Bagel Fat One'");
  });

  it("never names a font family or weight of its own: the page's fonts are the kit's, loaded and checked", () => {
    expect(PLAYFUL_CSS).not.toMatch(/font-family\s*:\s*(?!var\()/);
    expect(PLAYFUL_CSS).not.toMatch(/font-weight\s*:/);
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

describe('the Playful CSS is print-safe', () => {
  it('has no filter, backdrop-filter, blend mode, remote url or @import, in its CSS or its tokens', () => {
    expect(PLAYFUL_CSS.length).toBeGreaterThan(0);
    expect(printSafetyProblems(PLAYFUL_CSS)).toEqual([]);
    expect(printSafetyProblems(Object.values(PLAYFUL_TOKENS).join(';'))).toEqual([]);
    expect(PLAYFUL_CSS).not.toMatch(/url\(/i); // and no image at all: a texture would be an asset tile
  });

  it.each([
    ['.a { filter: blur(2px) }', 'filter'],
    ['.a { backdrop-filter: blur(4px) }', 'backdrop-filter'],
    ['.a { mix-blend-mode: multiply }', 'blend mode'],
    ['.a { background-blend-mode: screen }', 'blend mode'],
    ['.a { background: url(https://example.com/tile.png) }', 'remote url'],
    ['.a { background: url("//cdn.example.com/tile.png") }', 'remote url'],
    ['.a { background: url(data:image/png;base64,AAAA) }', 'remote url'],
    ['@import "https://example.com/more.css";', '@import'],
  ])('the check catches %s', (css, problem) => {
    expect(printSafetyProblems(css)).toContain(problem);
  });
});

describe('Bangla in the Playful look (§07, §08)', () => {
  it('keeps at least the Bangla line-heights in the font manifest', () => {
    const baloo = FONT_MANIFEST.fonts.find((font) => font.family === 'Baloo Da 2');
    const style = styleOf(page('bn'));
    const body = Number(/--lh-body: ([\d.]+);/.exec(style)?.[1]);
    const heading = Number(/--lh-heading: ([\d.]+);/.exec(style)?.[1]);
    expect(body).toBeGreaterThanOrEqual(baloo?.banglaLineHeight?.body ?? 99);
    expect(heading).toBeGreaterThanOrEqual(baloo?.banglaLineHeight?.heading ?? 99);
    expect(body).toBeGreaterThanOrEqual(BANGLA_LINE_HEIGHT_MIN.body);
    expect(heading).toBeGreaterThanOrEqual(BANGLA_LINE_HEIGHT_MIN.heading);
  });

  it('never sets a line-height of its own, nor the line-height variables', () => {
    expect(PLAYFUL_CSS).not.toMatch(/line-height\s*:/i);
    expect(PLAYFUL_CSS).not.toMatch(/--lh-/);
  });

  it('keeps headings balanced: no rule changes how the title wraps', () => {
    expect(declarationsFor(PLAYFUL_CSS, /\.title$/)).not.toMatch(/text-wrap|white-space/);
    expect(PLAYFUL_CSS).not.toMatch(/text-wrap\s*:\s*(?!balance|pretty)/);
  });

  it('sets no letter-spacing, case or italic anywhere, in either language', () => {
    expect(PLAYFUL_CSS).not.toMatch(
      /letter-spacing|word-spacing|text-transform|uppercase|capitalize|italic|oblique/i,
    );
    expect(PLAYFUL_CSS).not.toMatch(/:lang\(/);
  });
});

describe('what the look may not change (§07: layout geometry, type scale, safe zones)', () => {
  it('sets no font size, and none of the size, margin or scale variables', () => {
    expect(PLAYFUL_CSS).not.toMatch(/font-size\s*:/i);
    expect(PLAYFUL_CSS).not.toMatch(
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
      expect(declarationsFor(PLAYFUL_CSS, block)).not.toMatch(
        /(^|[;\s])(padding|margin|width|height|gap|flex)[\w-]*\s*:/,
      );
    }
  });
});

describe('the Playful character (§07: warm, friendly; highlight = pill)', () => {
  it('sets the kicker in the primary', () => {
    expect(valueOf(declarationsFor(PLAYFUL_CSS, /\.kicker$/), 'color')).toBe('var(--primary)');
  });

  it("makes the look's default highlight a pill: ink on the accent, rounded by the corner switch", () => {
    for (const hl of [/\.hl-default mark\.hl$/, /\.hl-pill mark\.hl$/]) {
      const pill = declarationsFor(PLAYFUL_CSS, hl);
      expect(valueOf(pill, 'background')).toBe('var(--accent)');
      expect(valueOf(pill, 'color')).toBe('var(--ink)');
      expect(valueOf(pill, 'border-radius')).toBe('var(--playful-pill-radius)');
      expect(valueOf(pill, 'box-decoration-break')).toBe('clone');
    }
  });

  it('draws the underline and colour highlights in the primary, with no pill', () => {
    const underline = declarationsFor(PLAYFUL_CSS, /\.hl-underline mark\.hl$/);
    expect(valueOf(underline, 'text-decoration-line')).toBe('underline');
    expect(valueOf(underline, 'color')).toBe('var(--primary)');
    expect(valueOf(underline, 'background')).toBe('none');
    const colour = declarationsFor(PLAYFUL_CSS, /\.hl-color mark\.hl$/);
    expect(valueOf(colour, 'color')).toBe('var(--primary)');
    expect(valueOf(colour, 'background')).toBe('none');
  });

  it('rounds the pill more as the corners go from sharp to soft to round', () => {
    const em = (corners: string) =>
      parseFloat(PLAYFUL_TOKENS[`playful-pill-radius-${corners}`] ?? 'NaN');
    expect(em('sharp')).toBe(0);
    expect(em('soft')).toBeGreaterThan(0);
    expect(em('round')).toBeGreaterThan(em('soft'));
  });
});

/** A rotation token (`-3deg`) in degrees. */
const degrees = (token: string): number => {
  const match = /^(-?[\d.]+)deg$/.exec(PLAYFUL_TOKENS[token] ?? '');
  if (match === null) throw new Error(`--${token} is not an angle in degrees`);
  return Number(match[1]);
};

describe('the print photo frame tilts a few degrees (§07: tilted "print" frames)', () => {
  it('turns the print frame by its tilt, a few degrees', () => {
    const print = declarationsFor(PLAYFUL_CSS, /^\.frame-print \.image-box$/);
    expect(valueOf(print, 'transform')).toBe('rotate(var(--playful-print-tilt))');
    expect(Math.abs(degrees('playful-print-tilt'))).toBeGreaterThanOrEqual(2);
    expect(Math.abs(degrees('playful-print-tilt'))).toBeLessThanOrEqual(6);
  });

  it('gives the print a border in the background, deeper at the foot like a photo print', () => {
    const print = declarationsFor(PLAYFUL_CSS, /^\.frame-print \.image-box$/);
    expect(valueOf(print, 'border')).toBe('var(--playful-print-border) solid var(--background)');
    expect(valueOf(print, 'border-bottom-width')).toBe('var(--playful-print-foot)');
    expect(parseFloat(PLAYFUL_TOKENS['playful-print-foot'] ?? '0')).toBeGreaterThan(
      parseFloat(PLAYFUL_TOKENS['playful-print-border'] ?? '0'),
    );
  });

  it('keeps the other frames straight', () => {
    for (const frame of ['none', 'rounded', 'full-bleed']) {
      const declarations = declarationsFor(
        PLAYFUL_CSS,
        new RegExp(`\\.frame-${frame} \\.image-box$`),
      );
      expect(valueOf(declarations, 'transform')).toBe('none');
    }
  });
});

// The stickers (§07): two decorations on `.slide::before` (a round badge) and `.slide::after` (a tilted tag), in the
// corner of the safe zones away from the logo. Their boxes are worked out here from the CSS itself, with the size's
// variables and the look's tokens put in, so a change to the CSS that pushes a sticker out of the safe zones fails.

type LogoPosition = Switches['logo'];
const LOGOS: LogoPosition[] = ['bottom-left', 'bottom-right', 'top'];
type Box = { left: number; top: number; right: number; bottom: number; tilt: number };

/** Every variable a sticker rule can use, in pixels or as a plain number, for one size. */
function variables(size: SizeName): Map<string, number> {
  const found = new Map<string, number>();
  for (const [, name, value] of sizeCss(size).matchAll(/--([\w-]+): ([\d.]+)px;/g))
    if (name !== undefined) found.set(name, Number(value));
  for (const [name, value] of Object.entries(PLAYFUL_TOKENS))
    if (/^-?[\d.]+(px)?$/.test(value)) found.set(name, parseFloat(value));
  const short = /--playful-short:\s*min\(var\(--w\), var\(--h\)\);/.test(PLAYFUL_CSS);
  if (!short) throw new Error('--playful-short is not min(var(--w), var(--h))');
  found.set('playful-short', Math.min(SIZES[size].width, SIZES[size].height));
  return found;
}

/** A length the sticker rules write: `var(--x)`, or `calc(var(--a) + var(--b) * var(--c))`, in pixels. */
function length(value: string, vars: Map<string, number>): number {
  const expression = value.replace(/^calc\((.*)\)$/, '$1');
  const number = (term: string): number => {
    const name = /^var\(--([\w-]+)\)$/.exec(term.trim())?.[1];
    const resolved = name === undefined ? Number(term.trim()) : vars.get(name);
    if (resolved === undefined || Number.isNaN(resolved))
      throw new Error(`can't work out "${term}"`);
    return resolved;
  };
  return expression
    .split(' + ')
    .map((sum) => sum.split(' * ').reduce((product, factor) => product * number(factor), 1))
    .reduce((total, term) => total + term, 0);
}

/** The page box of the sticker on `pseudo` (`::before`, `::after`), rotated about its centre, with that logo position. */
function stickerBox(size: SizeName, logo: LogoPosition, pseudo: '::before' | '::after'): Box {
  const vars = variables(size);
  const at = (selector: RegExp) => declarationsFor(PLAYFUL_CSS, selector);
  const shape = at(new RegExp(`^\\.decor-on \\.slide${pseudo}$`));
  const place = at(new RegExp(`^\\.logo-${logo} \\.slide${pseudo}$`));
  const get = (declarations: string, property: string) => {
    const value = valueOf(declarations, property);
    return value === undefined ? undefined : length(value, vars);
  };
  const width = get(shape, 'width');
  const height = get(shape, 'height');
  if (width === undefined || height === undefined) throw new Error(`${pseudo} has no size`);
  const { width: pageWidth, height: pageHeight } = SIZES[size];
  const [top, bottom, left, right] = ['top', 'bottom', 'left', 'right'].map((side) =>
    get(place, side),
  );
  const x = left ?? (right === undefined ? NaN : pageWidth - right - width);
  const y = top ?? (bottom === undefined ? NaN : pageHeight - bottom - height);
  if (Number.isNaN(x) || Number.isNaN(y)) throw new Error(`${pseudo} has no place for ${logo}`);
  const rotation = /^rotate\(var\(--([\w-]+)\)\)$/.exec(valueOf(shape, 'transform') ?? '')?.[1];
  const tilt = rotation === undefined ? 0 : degrees(rotation);
  const radians = (tilt * Math.PI) / 180;
  const halfWidth =
    (width * Math.abs(Math.cos(radians)) + height * Math.abs(Math.sin(radians))) / 2;
  const halfHeight =
    (width * Math.abs(Math.sin(radians)) + height * Math.abs(Math.cos(radians))) / 2;
  const [cx, cy] = [x + width / 2, y + height / 2];
  return {
    left: cx - halfWidth,
    right: cx + halfWidth,
    top: cy - halfHeight,
    bottom: cy + halfHeight,
    tilt,
  };
}

describe('the stickers sit inside the safe zones in every size (§07, §08)', () => {
  it('draws a round badge and a tilted tag, behind the text, only with decorations on', () => {
    const before = declarationsFor(PLAYFUL_CSS, /^\.decor-on \.slide::before$/);
    const after = declarationsFor(PLAYFUL_CSS, /^\.decor-on \.slide::after$/);
    for (const sticker of [before, after]) {
      expect(valueOf(sticker, 'content')).toBe("''");
      expect(valueOf(sticker, 'position')).toBe('absolute');
      expect(valueOf(sticker, 'z-index')).toBe('-1');
    }
    expect(valueOf(before, 'border-radius')).toBe('50%');
    expect(Math.abs(degrees('playful-tag-tilt'))).toBeGreaterThanOrEqual(5);
    expect(valueOf(declarationsFor(PLAYFUL_CSS, /\.slide$/), 'position')).toBe('relative');
  });

  it('removes both stickers with decorations off', () => {
    for (const pseudo of ['::before', '::after'])
      expect(
        valueOf(
          declarationsFor(PLAYFUL_CSS, new RegExp(`^\\.decor-off \\.slide${pseudo}$`)),
          'content',
        ),
      ).toBe('none');
  });

  for (const size of SIZE_NAMES)
    for (const logo of LOGOS)
      it(`${size}, logo ${logo}: both stickers' boxes, turned, are inside the safe zones`, () => {
        const { width, height, safeZones } = SIZES[size];
        const rounding = 1e-6; // floating point only: a real overstep is pixels
        for (const pseudo of ['::before', '::after'] as const) {
          const box = stickerBox(size, logo, pseudo);
          expect(box.left).toBeGreaterThanOrEqual(safeZones.left - rounding);
          expect(box.top).toBeGreaterThanOrEqual(safeZones.top - rounding);
          expect(box.right).toBeLessThanOrEqual(width - safeZones.right + rounding);
          expect(box.bottom).toBeLessThanOrEqual(height - safeZones.bottom + rounding);
        }
      });

  it('puts the stickers in the corner away from the logo', () => {
    const { width, height } = SIZES.portrait;
    const centre = (logo: LogoPosition) => {
      const box = stickerBox('portrait', logo, '::before');
      return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
    };
    expect(centre('bottom-left').x).toBeGreaterThan(width / 2);
    expect(centre('bottom-left').y).toBeLessThan(height / 2);
    expect(centre('bottom-right').x).toBeLessThan(width / 2);
    expect(centre('bottom-right').y).toBeLessThan(height / 2);
    expect(centre('top').y).toBeGreaterThan(height / 2);
  });

  it("sits the badge right in the safe zones' corner, so one pixel further out would fail the check", () => {
    // The story's overlays are the largest (top 250, right 130): the badge touches both edges exactly
    const badge = stickerBox('story', 'bottom-left', '::before');
    expect(badge.top).toBeCloseTo(SIZES.story.safeZones.top, 6);
    expect(badge.right).toBeCloseTo(SIZES.story.width - SIZES.story.safeZones.right, 6);
    const top = stickerBox('story', 'top', '::before');
    expect(top.bottom).toBeCloseTo(SIZES.story.height - SIZES.story.safeZones.bottom, 6);
    expect(top.left).toBeCloseTo(SIZES.story.safeZones.left, 6);
  });
});

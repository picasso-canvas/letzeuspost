import { expect, test } from '@playwright/test';
import {
  LAYOUT_NAMES,
  LOOK_NAMES,
  PostSchema,
  SIZE_NAMES,
  countWords,
  validateText,
  type Slide,
} from '../../packages/core/src/index.ts';
import { FONT_MANIFEST } from '../../packages/render/src/fonts/library.ts';
import { RenderKitSchema } from '../../packages/render/src/kit.ts';
import { brandAssets } from './assets.ts';
import { BRAND_IDS, FAILING_COLORS, SAMPLE_BRANDS } from './brands.ts';
import {
  GOLDEN_CASES,
  HARD_CASES,
  LANGS,
  LAUNCH_CASES,
  LAUNCH_LAYOUTS,
  LAUNCH_LOOKS,
  caseInput,
  casesFor,
  type GoldenCase,
} from './matrix.ts';

// The golden matrix as data (§08 Golden renders, §17, §18): what it holds, checked without a browser. The renders
// themselves are golden.spec.ts.

const combo = (c: GoldenCase) => `${c.layout}/${c.size}/${c.look}/${c.lang}`;

/** Every text a slide draws: not its alt text (the page's title, never drawn), its layout or its cta's mark (names). */
function drawnTexts(slide: Slide): string[] {
  return Object.entries(slide).flatMap(([field, value]): string[] => {
    if (field === 'alt' || field === 'layout' || field === 'mark') return [];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value))
      return value.flatMap((part: unknown) =>
        typeof part === 'string'
          ? [part]
          : typeof part === 'object' && part !== null && 'text' in part
            ? [String(part.text)]
            : [],
      );
    return [];
  });
}

const BENGALI = /[ঀ-৿]/u;

test('the launch matrix is exactly 200 cases: 10 layouts × 5 sizes × 2 looks × 2 languages', () => {
  expect(LAUNCH_LAYOUTS).toEqual(LAYOUT_NAMES.slice(0, 10));
  expect(LAUNCH_LOOKS).toEqual(['clean', 'playful']);
  expect(LAUNCH_CASES).toHaveLength(200);
  const combos = new Set(LAUNCH_CASES.map(combo));
  expect(combos.size).toBe(200);
  for (const layout of LAUNCH_LAYOUTS)
    for (const size of SIZE_NAMES)
      for (const look of LAUNCH_LOOKS)
        for (const lang of LANGS) expect(combos).toContain(`${layout}/${size}/${look}/${lang}`);
  expect(LAUNCH_CASES.every((c) => c.hard === undefined)).toBe(true);
});

test('the full set is the documented extension: the four other layouts and the two other looks make 560', () => {
  const full = casesFor(LAYOUT_NAMES, LOOK_NAMES);
  expect(full).toHaveLength(14 * 5 * 4 * 2);
  expect(full).toHaveLength(560);
  expect(full).toEqual(expect.arrayContaining(LAUNCH_CASES));
});

test('every case has its own id, which is a safe file name', () => {
  const ids = GOLDEN_CASES.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test('each sample brand appears at every size, in both looks and both languages', () => {
  expect(new Set(LAUNCH_CASES.map((c) => c.brand))).toEqual(new Set(BRAND_IDS));
  for (const brand of BRAND_IDS) {
    const its = LAUNCH_CASES.filter((c) => c.brand === brand);
    expect(new Set(its.map((c) => c.size))).toEqual(new Set(SIZE_NAMES));
    expect(new Set(its.map((c) => c.look))).toEqual(new Set(LAUNCH_LOOKS));
    expect(new Set(its.map((c) => c.lang))).toEqual(new Set(LANGS));
  }
});

test('three fictional brands: kits the renderer accepts, fonts from the manifest, logos and photos drawn in code', () => {
  expect(BRAND_IDS).toHaveLength(3);
  for (const id of BRAND_IDS) {
    const brand = SAMPLE_BRANDS[id];
    expect(RenderKitSchema.parse(brand.kit)).toEqual(brand.kit);
    for (const lang of LANGS)
      for (const role of ['heading', 'body'] as const) {
        const family = brand.kit.fonts[lang][role];
        const font = FONT_MANIFEST.fonts.find((f) => f.family === family);
        expect(font?.languages, `${id}: ${lang} ${role} font ${family}`).toContain(lang);
      }
    const assets = brandAssets(id);
    const keys = assets.map((a) => a.key);
    expect(keys).toEqual(
      expect.arrayContaining([brand.kit.logo.light, brand.kit.logo.dark, 'photo_1']),
    );
    if (brand.kit.mascot !== undefined) expect(keys).toContain(brand.kit.mascot);
    for (const asset of assets) {
      expect(asset.contentType).toBe('image/svg+xml');
      const svg = Buffer.from(asset.data).toString('utf8');
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /);
      // Shapes only: no text (an SVG's text would be drawn in a system font), nothing linked or embedded, no script.
      expect(svg).not.toMatch(/<text|<image|<script|<foreignObject|href=|url\((?!#)/i);
    }
  }
  // Each brand its own look: no two share a palette, a logo or a photo.
  const palettes = BRAND_IDS.map((id) => JSON.stringify(SAMPLE_BRANDS[id].kit.colors));
  expect(new Set(palettes).size).toBe(3);
  const drawn = BRAND_IDS.flatMap((id) =>
    brandAssets(id).map((a) => Buffer.from(a.data).toString('utf8')),
  );
  expect(new Set(drawn).size).toBe(drawn.length);
});

test('every case is a post the schema accepts, its slide drawn twice so the page number shows', () => {
  for (const golden of GOLDEN_CASES) {
    const { post } = caseInput(golden);
    expect(PostSchema.parse(post), golden.id).toEqual(post);
    expect(post).toMatchObject({ brand: golden.brand, lang: golden.lang, kind: 'carousel' });
    expect(post.look).toEqual({ name: golden.look, switches: {} });
    expect(post.slides).toHaveLength(2);
    expect(post.slides[0]).toBe(post.slides[1]);
    expect(post.slides[0]?.layout).toBe(golden.layout);
  }
});

test('sample content: every launch layout in English and Bangla, each in its own words, every text clean', () => {
  for (const layout of LAUNCH_LAYOUTS) {
    const [en, bn] = LANGS.map((lang) => {
      const golden = LAUNCH_CASES.find((c) => c.layout === layout && c.lang === lang);
      if (golden === undefined) throw new Error(`no ${layout} ${lang} case`);
      const slide = caseInput(golden).post.slides[0];
      if (slide === undefined) throw new Error('a slide');
      return drawnTexts(slide);
    });
    expect(en?.some((t) => BENGALI.test(t))).toBe(false);
    expect(bn?.every((t) => BENGALI.test(t))).toBe(true);
  }
  // No text a validator would flag: no dotted circle, no stray invisible character, no Latin digit in Bangla, no emoji,
  // highlights on word boundaries.
  for (const golden of GOLDEN_CASES) {
    const { post } = caseInput(golden);
    for (const text of drawnTexts(post.slides[0] ?? post.slides[1] ?? ({} as Slide)))
      expect(validateText(text, { lang: post.lang, surface: 'slide' }).issues, text).toEqual([]);
  }
});

test('the sample palettes pass both looks as they are: only the failing-palette case is shaded', () => {
  for (const golden of GOLDEN_CASES) {
    const { contrast, kit } = caseInput(golden);
    expect(contrast.failures, golden.id).toEqual([]);
    if (golden.hard === 'contrast') {
      // Shaded from the failing palette, and each warning says which colour moved, from what, to what.
      expect(contrast.warnings.length, golden.id).toBeGreaterThan(0);
      expect(kit.colors, golden.id).not.toEqual(FAILING_COLORS);
      for (const warning of contrast.warnings) {
        expect(warning.look, golden.id).toBe(golden.look);
        expect(warning.from, golden.id).not.toBe(warning.to);
      }
    } else {
      expect(contrast.warnings, golden.id).toEqual([]);
    }
  }
});

const hard = (kind: GoldenCase['hard']) => HARD_CASES.filter((c) => c.hard === kind);

test('hard case: the longest allowed text in every field of every launch layout, in both languages and looks', () => {
  const longest = hard('longest');
  expect(new Set(longest.map((c) => `${c.layout}/${c.look}/${c.lang}`)).size).toBe(
    LAUNCH_LAYOUTS.length * LAUNCH_LOOKS.length * LANGS.length,
  );
  for (const golden of longest) {
    const slide = caseInput(golden).post.slides[0];
    const typical = caseInput({ ...golden, hard: undefined }).post.slides[0];
    if (slide === undefined || typical === undefined) throw new Error('a slide');
    // Every field the sample draws is there, and each text at least as long as the sample's.
    expect(Object.keys(slide).sort()).toEqual(Object.keys(typical).sort());
    const length = (s: Slide) => drawnTexts(s).join(' ').length;
    expect(length(slide)).toBeGreaterThan(length(typical) * 2);
    // At the limits §07 sets: a cover title of 8 words, 5 list items and 4 options of 8 words each.
    if (slide.layout === 'cover') expect(countWords(slide.title)).toBe(8);
    if (slide.layout === 'list') {
      expect(slide.items).toHaveLength(5);
      for (const item of slide.items) expect(countWords(item)).toBe(8);
    }
    if (slide.layout === 'question') {
      expect(slide.options).toHaveLength(4);
      for (const option of slide.options)
        expect('text' in option ? countWords(option.text) : 0).toBe(8);
    }
  }
});

test('hard case: Bangla full of conjuncts, ya-phala and reph, at every size in both looks', () => {
  const cases = hard('conjuncts');
  expect(new Set(cases.map((c) => `${c.size}/${c.look}`)).size).toBe(SIZE_NAMES.length * 2);
  for (const golden of cases) {
    expect(golden.lang).toBe('bn');
    const text = drawnTexts(caseInput(golden).post.slides[0] ?? ({} as Slide)).join(' ');
    const count = (pattern: RegExp) => [...text.matchAll(pattern)].length;
    expect(count(/র্(?=[ক-হ])/gu), 'reph').toBeGreaterThanOrEqual(5);
    expect(count(/্য/gu), 'ya-phala').toBeGreaterThanOrEqual(5);
    expect(count(/র‍্য/gu), 'ya-phala after ra, with its joiner').toBeGreaterThanOrEqual(1);
    // A conjunct: two consonants joined by the hasanta, other than reph and ya-phala.
    expect(count(/[ক-হ]্(?!য)[ক-হ]/gu), 'conjuncts').toBeGreaterThanOrEqual(10);
    expect(count(/[ক-হ]্[ক-হ]্[ক-হ]/gu), 'three-letter conjuncts').toBeGreaterThanOrEqual(2);
  }
});

test('hard case: a missing image, in both languages and looks', () => {
  const cases = hard('missing-image');
  expect(cases).toHaveLength(4);
  for (const golden of cases) {
    const { post, assets, expected } = caseInput(golden);
    const keys = new Set(assets.map((a) => a.key));
    expect(expected.blocked).toHaveLength(1);
    const [missing = ''] = expected.blocked;
    expect(keys.has(missing)).toBe(false);
    expect(JSON.stringify(post.slides[0])).toContain(`"asset":"${missing}"`);
  }
});

test('hard case: a font with no Bangla drawing Bangla, expecting the fallback error', () => {
  const cases = hard('no-bangla-font');
  expect(cases).toHaveLength(2);
  for (const golden of cases) {
    const { post, kit, expected } = caseInput(golden);
    expect(expected.fontFallback).toBe(true);
    const families = Object.values(kit.fonts[post.lang]);
    for (const family of families)
      expect(FONT_MANIFEST.fonts.find((f) => f.family === family)?.languages).not.toContain('bn');
    expect(drawnTexts(post.slides[0] ?? ({} as Slide)).some((t) => BENGALI.test(t))).toBe(true);
  }
  // No other case expects a fallback, a blocked image or a shaded palette.
  for (const golden of GOLDEN_CASES) {
    const { expected } = caseInput(golden);
    expect(expected.fontFallback, golden.id).toBe(golden.hard === 'no-bangla-font');
    expect(expected.blocked.length > 0, golden.id).toBe(golden.hard === 'missing-image');
    expect(expected.contrastShaded, golden.id).toBe(golden.hard === 'contrast');
  }
});

test('hard case: a palette that fails contrast, expecting the shaded result and the warning', () => {
  const cases = hard('contrast');
  expect(cases).toHaveLength(4);
  expect(new Set(cases.map((c) => `${c.look}/${c.lang}`)).size).toBe(4);
});

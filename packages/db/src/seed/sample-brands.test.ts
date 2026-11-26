// Northwind Social's 3 sample brands (#411, §17 Test data, §21, §05's mockups), checked without a database: each kit is
// full and valid, has no logo yet (the logo assets are a follow-up task), and gives the renderer a kit it accepts.
// seed.int.test.ts saves them on Postgres through `createBrand` and `saveKit`.
import { describe, expect, it } from 'vitest';
import {
  BrandKitSchema,
  essentialsMissing,
  TEMPORARY_WORDMARK,
  toRenderKit,
} from '../../../core/src/index.ts';
// Tests may cross the package boundary (as core's render-kit.test.ts does): db doesn't depend on render, and this is
// the renderer's own schema and font library, so a sample kit the renderer would refuse fails here.
import { FONT_MANIFEST } from '../../../render/src/fonts/library.ts';
import { RenderKitSchema } from '../../../render/src/kit.ts';
import { sampleBrands } from './sample-brands.ts';

/** Whether the renderer has `family` for `language`: what the render job passes to `toRenderKit`. */
const isKnownFont = (family: string, language: 'en' | 'bn') =>
  FONT_MANIFEST.fonts.some((font) => font.family === family && font.languages.includes(language));

const PARTS = ['identity', 'voice', 'facts', 'look', 'rules', 'publishing', 'holidays'] as const;

/** The 3 sample brands; a check over each of them can't pass on an empty list. */
function three() {
  const brands = sampleBrands();
  expect(brands).toHaveLength(3);
  return brands;
}

describe('sampleBrands', () => {
  it('is Golpo Café (with its Bangla name), Ironline Studio and Brightwell Dental, each kit named as its brand', () => {
    const brands = three();
    expect(brands.map(({ nameEn, nameBn }) => [nameEn, nameBn])).toEqual([
      ['Golpo Café', 'গল্প ক্যাফে'],
      ['Ironline Studio', undefined],
      ['Brightwell Dental', undefined],
    ]);
    for (const { nameEn, nameBn, kit } of brands) {
      expect(kit.identity.name?.value).toBe(nameEn);
      expect(kit.identity.nameBn?.value).toBe(nameBn);
    }
  });

  it('has a full kit for each: valid, every part filled, no essential missing', () => {
    for (const { kit } of three()) {
      expect(BrandKitSchema.parse(kit)).toEqual(kit);
      for (const part of PARTS) expect(Object.keys(kit[part]).length).toBeGreaterThan(0);
      expect(essentialsMissing(kit)).toEqual([]);
    }
  });

  it('gives each brand its own look: Golpo Playful, Ironline Bold, Brightwell Clean', () => {
    expect(three().map(({ kit }) => kit.look.look?.value.name)).toEqual([
      'playful',
      'bold',
      'clean',
    ]);
  });

  it('has no logo assets yet, so the renderer gets the temporary wordmark for both backgrounds', () => {
    for (const { kit } of three()) {
      expect(kit.identity.logo).toBeUndefined();
      expect(kit.identity.mark).toBeUndefined();
      expect(kit.identity.mascot).toBeUndefined();
      expect(toRenderKit(kit).logo).toEqual({
        light: TEMPORARY_WORDMARK,
        dark: TEMPORARY_WORDMARK,
      });
    }
  });

  it('gives a RenderKit the renderer accepts, in the brand’s colours and with every font the renderer has', () => {
    for (const { kit } of three()) {
      const renderKit = toRenderKit(kit, { isKnownFont });
      expect(RenderKitSchema.safeParse(renderKit).success).toBe(true);
      expect(renderKit.colors.primary).toBe(kit.identity.colors?.primary?.value);
      for (const language of ['en', 'bn'] as const) {
        for (const role of ['heading', 'body'] as const) {
          const named = kit.identity.fonts?.[language]?.[role]?.value;
          if (named !== undefined && isKnownFont(named, language)) {
            expect(renderKit.fonts[language][role]).toBe(named);
          }
        }
      }
    }
  });

  it('gives Golpo Café its own Bangla fonts, which the renderer has', () => {
    const golpo = three()[0];
    expect(golpo === undefined ? undefined : toRenderKit(golpo.kit).fonts.bn).toEqual({
      heading: 'Baloo Da 2',
      body: 'Hind Siliguri',
    });
  });
});

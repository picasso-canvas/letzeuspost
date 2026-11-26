// Northwind Social's 3 sample brands (#411, §17 Test data, §21, §05's mockups), checked without a database: each kit is
// full and valid, has no logo in its first version, and gives the renderer a kit it accepts; each has its 3 logo files,
// and its second version (`withLogos`, #443) names their assets and still gives the renderer a kit it accepts.
// seed.int.test.ts saves them on Postgres through `createBrand` and `saveKit`; apps/worker's seed-dev.int.test.ts adds
// the logos.
import { randomUUIDv7 } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
import { sampleBrands, sampleLogos, withLogos } from './sample-brands.ts';

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

  it('has no logo in its first version, so the renderer gets the temporary wordmark for both backgrounds', () => {
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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Three fresh asset ids, as the asset table gives them. */
const logoIds = () => ({ light: randomUUIDv7(), dark: randomUUIDv7(), mark: randomUUIDv7() });

describe('sampleLogos (#443)', () => {
  it('names each brand’s logo for light and for dark backgrounds and its mark, from docs/design/logos', () => {
    const folders = ['golpo-cafe', 'ironline-studio', 'brightwell-dental'];
    three().forEach((sample, i) => {
      const logos = sampleLogos(sample);
      expect(logos.map(({ role, file }) => [role, file.pathname])).toEqual(
        [
          ['light', 'logo-light.png'],
          ['dark', 'logo-dark.png'],
          ['mark', 'mark.png'],
        ].map(([role, name]) => [
          role,
          expect.stringMatching(
            new RegExp(`/docs/design/logos/sample-brands/${String(folders[i])}/${String(name)}$`),
          ),
        ]),
      );
    });
  });

  it('points at PNG files that are there, which the store accepts (it refuses SVG) and the job reads (20 MB at most)', () => {
    for (const sample of three()) {
      for (const { file, contentType } of sampleLogos(sample)) {
        const bytes = readFileSync(file);
        expect(contentType).toBe('image/png');
        expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
        expect(bytes.byteLength).toBeLessThan(20 * 1024 * 1024);
      }
    }
  });

  it('describes each logo of a brand differently, by the brand’s name: the seed finds its own uploads by it', () => {
    const descriptions = three().flatMap((sample) =>
      sampleLogos(sample).map(({ description }) => description),
    );
    expect(new Set(descriptions).size).toBe(9);
    for (const sample of three()) {
      for (const { description } of sampleLogos(sample)) {
        expect(description).toContain(sample.nameEn);
      }
    }
  });
});

describe('withLogos (#443)', () => {
  it('fills the logo fields with the logo assets’ ids, each from its uploaded file, and changes nothing else', () => {
    for (const { kit } of three()) {
      const ids = logoIds();
      const second = withLogos(kit, ids);
      expect(BrandKitSchema.parse(second)).toEqual(second);
      expect(second.identity.logo).toEqual({
        light: expect.objectContaining({
          value: ids.light,
          source: 'file',
          ref: 'upload:logo-light.png',
        }),
        dark: expect.objectContaining({
          value: ids.dark,
          source: 'file',
          ref: 'upload:logo-dark.png',
        }),
      });
      expect(second.identity.mark).toEqual(
        expect.objectContaining({ value: ids.mark, source: 'file', ref: 'upload:mark.png' }),
      );
      const { logo: _logo, mark: _mark, ...identity } = second.identity;
      expect({ ...second, identity }).toEqual(kit);
    }
  });

  it('leaves the kit it was given as it was', () => {
    const [golpo] = three();
    if (golpo === undefined) throw new Error('no sample brand');
    const before = structuredClone(golpo.kit);
    withLogos(golpo.kit, logoIds());
    expect(golpo.kit).toEqual(before);
  });

  it('gives a RenderKit the renderer accepts, with the logo for each background in place of the wordmark', () => {
    for (const { kit } of three()) {
      const ids = logoIds();
      const renderKit = toRenderKit(withLogos(kit, ids), { isKnownFont });
      expect(RenderKitSchema.safeParse(renderKit).success).toBe(true);
      expect(renderKit.logo).toEqual({ light: ids.light, dark: ids.dark });
    }
  });
});

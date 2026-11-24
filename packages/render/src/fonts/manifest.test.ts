import { describe, expect, it } from 'vitest';
import { FONT_MANIFEST } from './library.ts';
import { FontManifestSchema } from './manifest.ts';

const HASH = 'a'.repeat(64);
const file = (
  weight: number,
  subset: 'latin' | 'bengali',
  fields: Record<string, unknown> = {},
) => ({
  weight,
  style: 'normal',
  subset,
  path: `@fontsource/hind-siliguri/files/hind-siliguri-${subset}-${String(weight)}-normal.woff2`,
  sha256: HASH,
  ...fields,
});
const bangla = (fields: Record<string, unknown> = {}) => ({
  family: 'Hind Siliguri',
  weights: [400],
  languages: ['bn'],
  licence: { spdx: 'OFL-1.1', path: '@fontsource/hind-siliguri/LICENSE' },
  banglaLineHeight: { body: 1.65, heading: 1.3 },
  files: [file(400, 'bengali'), file(400, 'latin')],
  ...fields,
});
const english = (fields: Record<string, unknown> = {}) => ({
  family: 'Nunito',
  weights: [400],
  languages: ['en'],
  licence: { spdx: 'OFL-1.1', path: '@fontsource/nunito/LICENSE' },
  files: [
    { ...file(400, 'latin'), path: '@fontsource/nunito/files/nunito-latin-400-normal.woff2' },
  ],
  ...fields,
});
const pair = (en: string, bn: string) => ({
  en: { heading: en, body: en },
  bn: { heading: bn, body: bn },
});
const manifest = (fields: Record<string, unknown> = {}) => ({
  fonts: [english(), bangla()],
  looks: { clean: pair('Nunito', 'Hind Siliguri') },
  ...fields,
});
const ok = (value: unknown) => FontManifestSchema.safeParse(value).success;

describe('FontManifestSchema', () => {
  it('accepts an English and a Bangla font paired for a look', () => {
    expect(ok(manifest())).toBe(true);
  });

  it("refuses Bangla line-heights under §07's minimums (body 1.65, headings 1.3)", () => {
    expect(
      ok(
        manifest({
          fonts: [english(), bangla({ banglaLineHeight: { body: 1.64, heading: 1.3 } })],
        }),
      ),
    ).toBe(false);
    expect(
      ok(
        manifest({
          fonts: [english(), bangla({ banglaLineHeight: { body: 1.65, heading: 1.29 } })],
        }),
      ),
    ).toBe(false);
  });

  it('refuses a Bangla font without Bangla line-heights', () => {
    expect(ok(manifest({ fonts: [english(), bangla({ banglaLineHeight: undefined })] }))).toBe(
      false,
    );
  });

  it('refuses a licence other than OFL-1.1, and a licence with no text path', () => {
    const licence = { spdx: 'GPL-3.0-only', path: '@fontsource/nunito/LICENSE' };
    expect(ok(manifest({ fonts: [english({ licence }), bangla()] }))).toBe(false);
    expect(ok(manifest({ fonts: [english({ licence: { spdx: 'OFL-1.1' } }), bangla()] }))).toBe(
      false,
    );
  });

  it('refuses a file without a sha256, or with a malformed one', () => {
    for (const sha256 of [undefined, 'abc', 'A'.repeat(64), `${HASH}0`]) {
      const files = [file(400, 'bengali', { sha256 }), file(400, 'latin')];
      expect(ok(manifest({ fonts: [english(), bangla({ files })] })), String(sha256)).toBe(false);
    }
  });

  it('refuses a font file that is a web address or leaves its package: fonts are never fetched', () => {
    for (const path of [
      'https://fonts.gstatic.com/s/hindsiliguri/v1/x.woff2',
      '@fontsource/hind-siliguri/files/../../../etc/passwd.woff2',
      '/usr/share/fonts/x.woff2',
      '@fontsource/hind-siliguri/files/x.ttf',
    ]) {
      const files = [file(400, 'bengali', { path }), file(400, 'latin')];
      expect(ok(manifest({ fonts: [english(), bangla({ files })] })), path).toBe(false);
    }
  });

  it('refuses a Bangla font with no Bengali file for one of its weights', () => {
    expect(ok(manifest({ fonts: [english(), bangla({ weights: [400, 700] })] }))).toBe(false);
    expect(ok(manifest({ fonts: [english(), bangla({ files: [file(400, 'latin')] })] }))).toBe(
      false,
    );
  });

  it('refuses a file for a weight the font does not list, and the same file twice', () => {
    const extra = [file(400, 'bengali'), file(400, 'latin'), file(700, 'bengali')];
    expect(ok(manifest({ fonts: [english(), bangla({ files: extra })] }))).toBe(false);
    const twice = [file(400, 'bengali'), file(400, 'bengali'), file(400, 'latin')];
    expect(ok(manifest({ fonts: [english(), bangla({ files: twice })] }))).toBe(false);
  });

  it('refuses two fonts with the same family', () => {
    expect(ok(manifest({ fonts: [english(), english(), bangla()] }))).toBe(false);
  });

  it("refuses a look pair that names a missing font or a font not set for the pair's language", () => {
    expect(ok(manifest({ looks: { clean: pair('Inter', 'Hind Siliguri') } }))).toBe(false);
    expect(ok(manifest({ looks: { clean: pair('Nunito', 'Nunito') } }))).toBe(false);
    const headingOnly = { ...pair('Nunito', 'Hind Siliguri'), en: { heading: 'Nunito' } };
    expect(ok(manifest({ looks: { clean: headingOnly } }))).toBe(false);
    expect(ok(manifest({ looks: { gothic: pair('Nunito', 'Hind Siliguri') } }))).toBe(false);
  });
});

describe('the launch library', () => {
  it('parses', () => {
    expect(FontManifestSchema.safeParse(FONT_MANIFEST).success).toBe(true);
  });

  it('pairs Clean with Nunito + Hind Siliguri, and Playful with Bagel Fat One + Baloo 2 and Baloo Da 2 (§08)', () => {
    expect(FONT_MANIFEST.looks).toEqual({
      clean: pair('Nunito', 'Hind Siliguri'),
      playful: {
        en: { heading: 'Bagel Fat One', body: 'Baloo 2' },
        bn: { heading: 'Baloo Da 2', body: 'Baloo Da 2' },
      },
    });
  });

  it('holds the five launch families, all OFL-1.1, with Bangla line-heights at least the minimums', () => {
    expect(FONT_MANIFEST.fonts.map((font) => font.family).sort()).toEqual([
      'Bagel Fat One',
      'Baloo 2',
      'Baloo Da 2',
      'Hind Siliguri',
      'Nunito',
    ]);
    for (const font of FONT_MANIFEST.fonts) {
      expect(font.licence.spdx).toBe('OFL-1.1');
      if (font.languages.includes('bn')) {
        expect(font.banglaLineHeight?.body).toBeGreaterThanOrEqual(1.65);
        expect(font.banglaLineHeight?.heading).toBeGreaterThanOrEqual(1.3);
      }
    }
  });
});

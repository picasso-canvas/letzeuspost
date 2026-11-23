import { LOOK_NAMES } from '@lzp/core';
import { z } from 'zod';

// The font manifest (§08 Fonts): every font a render may use, self-hosted, with its licence and the sha256 of each
// file. A file path names a file inside an installed font package, so it can't be a web address or leave the package.

export const FONT_LANGUAGES = ['en', 'bn'] as const;
export type FontLanguage = (typeof FONT_LANGUAGES)[number];

export const FONT_SUBSETS = ['latin', 'bengali'] as const;
export type FontSubset = (typeof FONT_SUBSETS)[number];

/** The subset a font needs for each language it is set for. */
export const SUBSET_FOR: Readonly<Record<FontLanguage, FontSubset>> = {
  en: 'latin',
  bn: 'bengali',
};

/** §07's Bangla minimums: body at least 1.65, headings at least 1.3. */
export const BANGLA_LINE_HEIGHT_MIN = { body: 1.65, heading: 1.3 } as const;

const PACKAGE = '@fontsource\\/[a-z0-9-]+';
const FILE_PATH = new RegExp(`^${PACKAGE}\\/files\\/[a-z0-9-]+\\.woff2$`);
const LICENCE_PATH = new RegExp(`^${PACKAGE}\\/LICENSE$`);

const weight = z.int().min(100).max(900).multipleOf(100);

const FontFileSchema = z.strictObject({
  weight,
  style: z.literal('normal'),
  subset: z.enum(FONT_SUBSETS),
  /** A file in an installed font package: `@fontsource/<font>/files/<file>.woff2`. */
  path: z.string().regex(FILE_PATH, 'a .woff2 file inside an @fontsource package'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'a lowercase hex sha256'),
});

const FontSchema = z
  .strictObject({
    family: z.string().min(1),
    weights: z.array(weight).min(1),
    languages: z.array(z.enum(FONT_LANGUAGES)).min(1),
    licence: z.strictObject({
      /** The free library is OFL only; licensed uploads by agencies are separate (§08, M2). */
      spdx: z.literal('OFL-1.1'),
      path: z.string().regex(LICENCE_PATH, 'the LICENSE file of an @fontsource package'),
    }),
    /** Only for a font set for Bangla. */
    banglaLineHeight: z
      .strictObject({
        body: z.number().min(BANGLA_LINE_HEIGHT_MIN.body),
        heading: z.number().min(BANGLA_LINE_HEIGHT_MIN.heading),
      })
      .optional(),
    files: z.array(FontFileSchema).min(1),
  })
  .superRefine(({ weights, languages, banglaLineHeight, files }, ctx) => {
    const issue = (message: string, path: PropertyKey[]) => {
      ctx.addIssue({ code: 'custom', message, path });
    };
    if (new Set(weights).size !== weights.length) issue('a weight is listed twice', ['weights']);
    if (new Set(languages).size !== languages.length)
      issue('a language is listed twice', ['languages']);
    if (languages.includes('bn') !== (banglaLineHeight !== undefined))
      issue('a font has Bangla line-heights exactly when it is set for bn', ['banglaLineHeight']);

    const seen = new Set<string>();
    files.forEach((file, i) => {
      const key = `${String(file.weight)} ${file.style} ${file.subset}`;
      if (seen.has(key)) issue(`a second file for ${key}`, ['files', i]);
      seen.add(key);
      if (!weights.includes(file.weight))
        issue(`weight ${String(file.weight)} isn't in weights`, ['files', i, 'weight']);
    });
    for (const language of languages) {
      const subset = SUBSET_FOR[language];
      for (const w of weights) {
        if (!seen.has(`${String(w)} normal ${subset}`))
          issue(`no ${subset} file for weight ${String(w)} (${language})`, ['files']);
      }
    }
  });

const roles = z.strictObject({ heading: z.string(), body: z.string() });

/** A look's default fonts: a heading and a body font for each language. */
const LookFontsSchema = z.strictObject({ en: roles, bn: roles });

export const FontManifestSchema = z
  .strictObject({
    fonts: z.array(FontSchema).min(1),
    looks: z.partialRecord(z.enum(LOOK_NAMES), LookFontsSchema),
  })
  .superRefine(({ fonts, looks }, ctx) => {
    const families = new Map(fonts.map((font) => [font.family, font]));
    if (families.size !== fonts.length)
      ctx.addIssue({ code: 'custom', message: 'a family is listed twice', path: ['fonts'] });
    for (const [look, pair] of Object.entries(looks)) {
      for (const language of FONT_LANGUAGES) {
        for (const role of ['heading', 'body'] as const) {
          const family = pair[language][role];
          if (families.get(family)?.languages.includes(language) !== true)
            ctx.addIssue({
              code: 'custom',
              message: `${family} isn't a font in the manifest set for ${language}`,
              path: ['looks', look, language, role],
            });
        }
      }
    }
  });

export type FontManifest = z.infer<typeof FontManifestSchema>;
export type Font = FontManifest['fonts'][number];
export type FontFile = Font['files'][number];

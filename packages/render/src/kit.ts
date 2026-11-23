import { LOOK_NAMES } from '@lzp/core';
import { z } from 'zod';
import { FONT_MANIFEST } from './fonts/library.ts';
import type { FontLanguage } from './fonts/manifest.ts';

// What a brand kit gives the renderer (§06 Identity: colors, heading and body fonts per language, logo for light and
// dark backgrounds, optional mascot; §08 Looks in the renderer). The kit's other fields (voice, facts, rules) never
// reach the renderer.

/** Colours go into CSS, so only six-digit hex is taken; nothing else can carry a declaration with it. */
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a six-digit hex colour like #1b1b1b');

/**
 * A stored asset (a logo, a mascot, a photo) is named by its key, never by a web address: the render page has no
 * internet and loads images only from the job's own asset scheme (`page/assets.ts`).
 */
export const ASSET_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const assetKey = z.string().regex(ASSET_KEY, 'an asset key, not a web address');

/** A font name from the font manifest, set for `language`. */
const fontFor = (language: FontLanguage) =>
  z
    .string()
    .refine(
      (name) =>
        FONT_MANIFEST.fonts.some(
          (font) => font.family === name && font.languages.includes(language),
        ),
      `a font in the font manifest that is set for this language`,
    );

const fontPair = (language: FontLanguage) =>
  z.strictObject({ heading: fontFor(language), body: fontFor(language) });

export const RenderKitSchema = z.strictObject({
  colors: z.strictObject({
    primary: colour,
    accent: colour,
    background: colour,
    ink: colour,
    extras: z.array(colour).max(8),
  }),
  /** A heading and a body font for each language; the names are the manifest's (§08 Fonts). */
  fonts: z.strictObject({ en: fontPair('en'), bn: fontPair('bn') }),
  /** The brand's logo for light backgrounds and for dark ones. */
  logo: z.strictObject({ light: assetKey, dark: assetKey }),
  mascot: assetKey.optional(),
});

export type RenderKit = z.infer<typeof RenderKitSchema>;

// Look CSS is our own, but it ends up in a page that is also printed to PDF (§08): print-safe CSS only.
const NOT_PRINT_SAFE = /filter|blend/i; // filter, backdrop-filter, mix-blend-mode, background-blend-mode
const CLOSES_STYLE = /<\/style|<!--/i;

const tokenName = z.string().regex(/^[a-z][a-z0-9-]*$/, 'a lowercase CSS variable name');
const tokenValue = z.string().regex(/^[^;{}<>\\]+$/, 'a plain CSS value');

/**
 * What a look registers itself with (`registerLook`, §08): its CSS on top of the shared base, and its tokens (the
 * `DESIGN.md` values it needs), which become CSS variables on the page. The cache key holds `version` (§08), so a
 * look's version goes up whenever its CSS or tokens change.
 */
export const LookDefinitionSchema = z.strictObject({
  name: z.enum(LOOK_NAMES),
  version: z.int().positive(),
  css: z
    .string()
    .refine(
      (css) => !NOT_PRINT_SAFE.test(css),
      'print-safe CSS only: no filter, backdrop blur or blend mode',
    )
    .refine((css) => !CLOSES_STYLE.test(css), 'CSS that closes its style element'),
  tokens: z.record(tokenName, tokenValue),
});

export type LookDefinition = z.infer<typeof LookDefinitionSchema>;

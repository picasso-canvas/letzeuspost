import { TEMPORARY_WORDMARK, type BrandKit } from './kit.ts';

// What the renderer takes from a kit (§06 How the kit is used: identity and look). This is the shape of
// `RenderKit` in @lzp/render, written out here because render depends on core, not the other way round; render-kit.test.ts
// parses the result with render's own `RenderKitSchema`, so the two can't drift apart unseen.

type Language = 'en' | 'bn';

interface FontPair {
  heading: string;
  body: string;
}

export interface RenderKitData {
  colors: { primary: string; accent: string; background: string; ink: string; extras: string[] };
  fonts: Record<Language, FontPair>;
  /** An asset key for each background; `TEMPORARY_WORDMARK` for both when the kit has no logo. */
  logo: { light: string; dark: string };
  mascot?: string;
}

/** Used for a colour the kit doesn't have yet: plain black on white, so a new brand's slides are readable. */
const DEFAULT_COLORS = { primary: '#1b1b1b', background: '#ffffff', ink: '#1b1b1b' };

/** Used when the kit names no font, or one the renderer doesn't have: the fonts every look can set (§08 Fonts). */
const DEFAULT_FONTS: Record<Language, FontPair> = {
  en: { heading: 'Nunito', body: 'Nunito' },
  bn: { heading: 'Hind Siliguri', body: 'Hind Siliguri' },
};

export interface ToRenderKitOptions {
  /** Whether the renderer has this font for this language (its font manifest). Without it every named font is kept. */
  isKnownFont?: (family: string, language: Language) => boolean;
}

/**
 * The kit as the renderer takes it. It is always valid: a colour or font the kit lacks gets a default, and a kit with
 * no logo gets `TEMPORARY_WORDMARK` for both backgrounds, for the renderer to draw as the name (§06 Missing pieces).
 * A kit with one logo uses it on both backgrounds.
 */
export function toRenderKit(kit: BrandKit, options: ToRenderKitOptions = {}): RenderKitData {
  const { colors, logo, fonts, mascot } = kit.identity;
  const known = options.isKnownFont ?? (() => true);
  const font = (language: Language, role: keyof FontPair): string => {
    const named = fonts?.[language]?.[role]?.value;
    return named !== undefined && known(named, language) ? named : DEFAULT_FONTS[language][role];
  };
  const primary = colors?.primary?.value ?? DEFAULT_COLORS.primary;
  const logoLight = logo?.light?.value ?? logo?.dark?.value ?? TEMPORARY_WORDMARK;
  const logoDark = logo?.dark?.value ?? logo?.light?.value ?? TEMPORARY_WORDMARK;
  return {
    colors: {
      primary,
      accent: colors?.accent?.value ?? primary,
      background: colors?.background?.value ?? DEFAULT_COLORS.background,
      ink: colors?.ink?.value ?? DEFAULT_COLORS.ink,
      extras: (colors?.extras ?? []).map((extra) => extra.value),
    },
    fonts: {
      en: { heading: font('en', 'heading'), body: font('en', 'body') },
      bn: { heading: font('bn', 'heading'), body: font('bn', 'body') },
    },
    logo: { light: logoLight, dark: logoDark },
    ...(mascot === undefined ? {} : { mascot: mascot.value }),
  };
}

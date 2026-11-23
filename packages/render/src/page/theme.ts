import { FONT_MANIFEST } from '../fonts/library.ts';
import {
  BANGLA_LINE_HEIGHT_MIN,
  type Font,
  type FontFile,
  type FontLanguage,
} from '../fonts/manifest.ts';
import type { LookDefinition, RenderKit } from '../kit.ts';
import { assetUrl } from './assets.ts';

// The brand's tokens as CSS variables, and the fonts the page uses (§08: "the brand's tokens as CSS variables, the
// fonts"). Everything here comes from values the schemas have already checked (hex colours, manifest font names,
// look tokens), so nothing can carry a declaration or a rule with it.

const font = (name: string, language: FontLanguage): Font => {
  const found = FONT_MANIFEST.fonts.find(
    (candidate) => candidate.family === name && candidate.languages.includes(language),
  );
  if (found === undefined) throw new Error(`"${name}" is not a ${language} font in the manifest`);
  return found;
};

/** The weight the font has that is nearest to `wanted`: never a weight it lacks, so the browser can't fake a bold. */
const nearestWeight = (weights: readonly number[], wanted: number): number =>
  weights.reduce((best, weight) =>
    Math.abs(weight - wanted) < Math.abs(best - wanted) ? weight : best,
  );

// Each subset's own characters, so a family with Latin and Bengali files draws each script from the right file.
const UNICODE_RANGE: Record<FontFile['subset'], string> = {
  latin:
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  bengali: 'U+0951-0952, U+0964-0965, U+0980-09FE, U+1CF7, U+200C-200D, U+20B9, U+25CC',
};

/** One `@font-face` per file of the families in use. Bengali comes last: it owns the joiners U+200C-200D. */
function fontFaces(families: readonly Font[]): string {
  return families
    .flatMap((family) =>
      [...family.files]
        .sort((a, b) => Number(a.subset === 'bengali') - Number(b.subset === 'bengali'))
        .map(
          (file) => `@font-face {
  font-family: '${family.family}';
  font-style: ${file.style};
  font-weight: ${String(file.weight)};
  font-display: block;
  src: url(${assetUrl('font', file.sha256)}) format('woff2');
  unicode-range: ${UNICODE_RANGE[file.subset]};
}`,
        ),
    )
    .join('\n');
}

/**
 * The CSS that is about this post's brand and look: the fonts, then the `:root` variables (colours, fonts, weights,
 * line-heights, the look's tokens). The look's own CSS goes after the base CSS, in `buildSlide`. Bangla line-heights are the font's, never below §07's
 * minimums (body 1.65, headings 1.3).
 */
export function themeCss(kit: RenderKit, language: FontLanguage, look: LookDefinition): string {
  const heading = font(kit.fonts[language].heading, language);
  const body = font(kit.fonts[language].body, language);
  const used = heading === body ? [heading] : [heading, body];
  const lineHeight =
    language === 'bn'
      ? {
          body: Math.max(BANGLA_LINE_HEIGHT_MIN.body, body.banglaLineHeight?.body ?? 0),
          heading: Math.max(BANGLA_LINE_HEIGHT_MIN.heading, heading.banglaLineHeight?.heading ?? 0),
        }
      : { body: 1.5, heading: 1.15 };
  const variables: [string, string][] = [
    ['primary', kit.colors.primary],
    ['accent', kit.colors.accent],
    ['background', kit.colors.background],
    ['ink', kit.colors.ink],
    ...kit.colors.extras.map((colour, i): [string, string] => [`extra-${String(i + 1)}`, colour]),
    ['font-heading', `'${heading.family}'`],
    ['font-body', `'${body.family}'`],
    ['weight-heading', String(nearestWeight(heading.weights, 700))],
    ['weight-body', String(nearestWeight(body.weights, 400))],
    ['lh-body', String(lineHeight.body)],
    ['lh-heading', String(lineHeight.heading)],
    ...Object.entries(look.tokens),
  ];
  return `${fontFaces(used)}
:root {
${variables.map(([name, value]) => `  --${name}: ${value};`).join('\n')}
}
`;
}

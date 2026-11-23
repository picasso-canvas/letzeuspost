import { FONT_MANIFEST } from '../../fonts/library.ts';
import type { LookDefinition, RenderKit } from '../../kit.ts';
import { registerLook } from '../../page/looks.ts';
import { CLEAN_CSS } from './css.ts';
import { CLEAN_TOKENS } from './tokens.ts';

// The Clean look (§07 The four looks): calm, lots of space, rounded sans, a soft tinted ground, highlight = underline.
// Loading this module registers it with the renderer (§08), as `looks/index.ts` does for every look.

const fonts = FONT_MANIFEST.looks.clean;
if (fonts === undefined) throw new Error('The font manifest has no pair for the Clean look');

/** Clean's own English and Bangla font pair, from the font manifest (§08 Fonts): Nunito + Hind Siliguri. */
export const CLEAN_FONTS: RenderKit['fonts'] = fonts;

/** Raise `version` whenever the CSS or the tokens change: the render cache key holds it (§08). */
export const CLEAN_LOOK: LookDefinition = {
  name: 'clean',
  version: 1,
  css: CLEAN_CSS,
  tokens: CLEAN_TOKENS,
};

registerLook(CLEAN_LOOK);

export { cleanContrast, cleanPairs, cleanTints } from './contrast.ts';

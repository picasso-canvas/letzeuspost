import { FONT_MANIFEST } from '../../fonts/library.ts';
import type { LookDefinition, RenderKit } from '../../kit.ts';
import { registerLook } from '../../page/looks.ts';
import { PLAYFUL_CSS } from './css.ts';
import { PLAYFUL_TOKENS } from './tokens.ts';

// The Playful look (§07 The four looks): warm, friendly, heavy rounded display, tilted "print" photo frames, stickers,
// highlight = pill; the studio's own picasso look. Loading this module registers it with the renderer (§08), as
// `looks/index.ts` does for every look.

const fonts = FONT_MANIFEST.looks.playful;
if (fonts === undefined) throw new Error('The font manifest has no pair for the Playful look');

/**
 * Playful's own English and Bangla font pair, from the font manifest (§08 Fonts): English headings (kicker and title)
 * in Bagel Fat One and the body in Baloo 2; Bangla headings and body both in Baloo Da 2, the headings at its bold
 * weight and the body at its regular one (`page/theme.ts` picks the weights the font has).
 */
export const PLAYFUL_FONTS: RenderKit['fonts'] = fonts;

/** Raise `version` whenever the CSS or the tokens change: the render cache key holds it (§08). */
export const PLAYFUL_LOOK: LookDefinition = {
  name: 'playful',
  version: 1,
  css: PLAYFUL_CSS,
  tokens: PLAYFUL_TOKENS,
};

registerLook(PLAYFUL_LOOK);

export { playfulContrast, playfulPairs, playfulTints } from './contrast.ts';

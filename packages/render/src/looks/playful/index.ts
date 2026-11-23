import type { LookDefinition, RenderKit } from '../../kit.ts';
import { PLAYFUL_CSS } from './css.ts';
import { PLAYFUL_TOKENS } from './tokens.ts';

// The Playful look. Not registered yet.

export const PLAYFUL_FONTS: RenderKit['fonts'] = {
  en: { heading: 'Nunito', body: 'Nunito' },
  bn: { heading: 'Hind Siliguri', body: 'Hind Siliguri' },
};

export const PLAYFUL_LOOK: LookDefinition = {
  name: 'playful',
  version: 1,
  css: PLAYFUL_CSS,
  tokens: PLAYFUL_TOKENS,
};

export { playfulContrast, playfulPairs, playfulTints } from './contrast.ts';

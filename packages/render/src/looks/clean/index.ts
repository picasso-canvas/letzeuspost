import type { LookDefinition, RenderKit } from '../../kit.ts';

export const CLEAN_FONTS: RenderKit['fonts'] = {
  en: { heading: 'Nunito', body: 'Nunito' },
  bn: { heading: 'Nunito', body: 'Nunito' },
};
export const CLEAN_LOOK: LookDefinition = { name: 'clean', version: 1, css: '', tokens: {} };

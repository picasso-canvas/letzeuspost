// Every look the renderer has (§07, §08). Loading this module registers them all; the worker and the editor load it
// once, before they build a slide. Bold and Editorial come in their own tasks.
export { CLEAN_FONTS, CLEAN_LOOK, cleanContrast, cleanPairs, cleanTints } from './clean/index.ts';
export {
  PLAYFUL_FONTS,
  PLAYFUL_LOOK,
  playfulContrast,
  playfulPairs,
  playfulTints,
} from './playful/index.ts';

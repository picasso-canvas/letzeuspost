// Every look the renderer has (§07, §08). Loading this module registers them all; the worker and the editor load it
// once, before they build a slide. Bold, Editorial and Playful come in their own tasks.
export { CLEAN_FONTS, CLEAN_LOOK, cleanContrast, cleanPairs, cleanTints } from './clean/index.ts';

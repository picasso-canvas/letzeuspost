import { z } from 'zod';

// The four looks and the safe switches an agency can set per brand (§07). Layout geometry, type scale and safe
// zones are not switches.
export const LOOK_NAMES = ['bold', 'clean', 'editorial', 'playful'] as const;

export type LookName = (typeof LOOK_NAMES)[number];

const switchesSchema = z.strictObject({
  corners: z.enum(['sharp', 'soft', 'round']).optional(),
  frame: z.enum(['none', 'print', 'rounded', 'full-bleed']).optional(),
  /** `default`: the look's own highlight. */
  highlight: z.enum(['default', 'pill', 'underline', 'color']).optional(),
  decorations: z.boolean().optional(),
  logo: z.enum(['bottom-left', 'bottom-right', 'top']).optional(),
});

export const LookSchema = z.strictObject({
  name: z.enum(LOOK_NAMES),
  switches: switchesSchema.default({}),
});

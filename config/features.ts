// Feature switches (§15 Zeus's admin panel): a named list of features, each on or off per workspace, so a feature can
// go to one partner first. New features start off. The list is §18's "right after launch" work (M8, and §10's stock
// and AI images); switching one on for a workspace is the admin panel's job (M6).
import { z } from 'zod';

const featureSchema = z.strictObject({
  /** What Zeus sees in the admin panel. */
  label: z.string().trim().min(1),
  /** The plan section that specifies it. */
  section: z.string().regex(/^§\d{2}$/),
  /** Every feature starts off (§15); a workspace gets it when Zeus switches it on. */
  defaultOn: z.literal(false),
});

export const featuresSchema = z.record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/), featureSchema);

export const features = {
  clientPhotoUploads: {
    label: 'Photos from the client on the review page',
    section: '§10',
    defaultOn: false,
  },
  productCutouts: { label: 'Product cutouts', section: '§10', defaultOn: false },
  lookBold: { label: 'The Bold look', section: '§07', defaultOn: false },
  lookEditorial: { label: 'The Editorial look', section: '§07', defaultOn: false },
  layoutTestimonial: { label: 'The testimonial layout', section: '§07', defaultOn: false },
  layoutPhotocard: { label: 'The photo card layout', section: '§07', defaultOn: false },
  layoutMeme: { label: 'The meme layout', section: '§07', defaultOn: false },
  layoutBeforeafter: { label: 'The before/after layout', section: '§07', defaultOn: false },
  stockImages: { label: 'Stock image search', section: '§10', defaultOn: false },
  aiImages: { label: 'AI image generation', section: '§10', defaultOn: false },
} as const satisfies z.input<typeof featuresSchema>;

export type FeatureName = keyof typeof features;

featuresSchema.parse(features);

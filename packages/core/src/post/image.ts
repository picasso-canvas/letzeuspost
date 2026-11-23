import { z } from 'zod';
import { text } from './text.ts';

/** A point on the photo as fractions of its width and height: (0, 0) top left, (1, 1) bottom right. */
const focusPoint = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

/**
 * A photo in a slide: a library asset, the crop and the focus point (§07's example, §10 Crop and focus). The crop is
 * `[x, y, width, height]` in pixels of the photo; the focus is `"center"` or a point.
 */
export const ImageRefSchema = z.strictObject({
  asset: text,
  crop: z
    .tuple([z.int().min(0), z.int().min(0), z.int().positive(), z.int().positive()])
    .optional(),
  focus: z.union([z.literal('center'), focusPoint]).optional(),
});

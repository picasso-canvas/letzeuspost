import { z } from 'zod';
import { NETWORKS } from '../text/caption-length.ts';
import { LookSchema } from './look.ts';
import { SlideSchema } from './slide.ts';
import { text } from './text.ts';

// post.json v2 (§07 Post content format). Caption lengths and hashtag counts are checked against the network table
// elsewhere (§09, §12), and the flags are checked when a post is sent for approval (§11), not here.
export const POST_KINDS = [
  'single',
  'carousel',
  'story',
  'question',
  'textOnly',
  'document',
] as const;

type PostKind = (typeof POST_KINDS)[number];

/** How many slides each kind has (§07 Post kinds); a carousel is capped at 10 at launch. */
const SLIDES: Record<PostKind, { min: number; max: number }> = {
  single: { min: 1, max: 1 },
  carousel: { min: 2, max: 10 },
  story: { min: 1, max: 1 },
  question: { min: 1, max: 1 },
  textOnly: { min: 0, max: 0 },
  document: { min: 2, max: 10 },
};

/** Carousels are shorter on some networks (§07). */
const CAROUSEL_CAPS: Partial<Record<(typeof NETWORKS)[number], number>> = { pinterest: 5, x: 4 };

const network = z.enum(NETWORKS);

const caption = z.strictObject({
  text,
  /** For networks that have a title field. */
  title: text.optional(),
  hashtags: z.array(z.string().regex(/^#\S+$/u)).optional(),
});

export const PostSchema = z
  .strictObject({
    brand: text,
    lang: z.enum(['en', 'bn']),
    /** The other-language version of this post, if there is one. */
    linkedTo: text.optional(),
    kind: z.enum(POST_KINDS),
    networks: z
      .array(network)
      .min(1)
      .refine((names) => new Set(names).size === names.length, 'Each network once'),
    date: z.iso.datetime({ offset: true }),
    look: LookSchema,
    slides: z.array(SlideSchema),
    captions: z.partialRecord(network, caption),
    sources: z.array(text).optional(),
    credits: z.array(text).optional(),
    /** `null` until someone sets it. */
    flags: z.strictObject({
      aiImage: z.boolean(),
      claimsConfirmed: z.boolean().nullable(),
      testimonialConsent: z.boolean().nullable(),
    }),
  })
  .superRefine(({ kind, networks, slides }, ctx) => {
    const { min, max: kindMax } = SLIDES[kind];
    const caps = kind === 'carousel' ? networks.flatMap((name) => CAROUSEL_CAPS[name] ?? []) : [];
    const max = Math.min(kindMax, ...caps);
    if (slides.length < min || slides.length > max) {
      ctx.addIssue({
        code: 'custom',
        path: ['slides'],
        message: `A ${kind} post has ${String(min)}–${String(max)} slides, not ${String(slides.length)}`,
      });
    }
    if (kind === 'question') {
      slides.forEach((slide, index) => {
        if (slide.layout !== 'question') {
          ctx.addIssue({
            code: 'custom',
            path: ['slides', index, 'layout'],
            message: 'A question post uses the question layout',
          });
        }
      });
    }
  });

export type Post = z.infer<typeof PostSchema>;

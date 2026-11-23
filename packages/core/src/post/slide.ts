import { z } from 'zod';
import { ImageRefSchema } from './image.ts';
import { text } from './text.ts';
import { countWords } from './words.ts';

// One schema per layout, with §07's layout table as the fields and its rules as checks. The renderer builds the
// first 10 at launch; testimonial, photocard, meme and beforeafter follow (M8). `*word*` in a title marks a highlight.
export const LAYOUT_NAMES = [
  'cover',
  'fact',
  'step',
  'list',
  'quote',
  'stat',
  'question',
  'offer',
  'cta',
  'text',
  'testimonial',
  'photocard',
  'meme',
  'beforeafter',
] as const;

export type LayoutName = (typeof LAYOUT_NAMES)[number];

/** Every slide has alt text. */
const alt = { alt: text };

const MAX_WORDS = 8;
const atMostEightWords = (value: string) => countWords(value) <= MAX_WORDS;
const EIGHT_WORDS = `At most ${String(MAX_WORDS)} words`;

const cover = z.strictObject({
  layout: z.literal('cover'),
  kicker: text,
  title: text.refine(atMostEightWords, EIGHT_WORDS),
  body: text.optional(),
  image: ImageRefSchema.optional(),
  sticker: text.optional(),
  ...alt,
});

const fact = z.strictObject({
  layout: z.literal('fact'),
  kicker: text,
  title: text,
  image: ImageRefSchema.optional(),
  body: text,
  source: text,
  ...alt,
});

const step = z
  .strictObject({
    layout: z.literal('step'),
    /** Step number, and how many steps there are. */
    n: z.int().min(1),
    of: z.int().min(1),
    image: ImageRefSchema,
    title: text,
    body: text,
    ...alt,
  })
  .refine(({ n, of }) => n <= of, { path: ['n'], message: 'The step number is at most `of`' });

const list = z.strictObject({
  layout: z.literal('list'),
  title: text,
  items: z.array(text.refine(atMostEightWords, EIGHT_WORDS)).min(3).max(5),
  ...alt,
});

const quote = z
  .strictObject({
    layout: z.literal('quote'),
    quote: text,
    person: text,
    role: text,
    /** A public quote (not a line from the brand's own people). */
    public: z.boolean(),
    source: text.optional(),
    ...alt,
  })
  .refine(({ public: isPublic, source }) => !isPublic || source !== undefined, {
    path: ['source'],
    message: 'A public quote needs a source',
  });

const stat = z.strictObject({
  layout: z.literal('stat'),
  number: text,
  label: text,
  source: text,
  ...alt,
});

/** An answer to a community question: text or an image. */
const option = z.union([z.strictObject({ text }), z.strictObject({ image: ImageRefSchema })]);

const question = z.strictObject({
  layout: z.literal('question'),
  kicker: text,
  question: text,
  options: z.array(option).min(2).max(4),
  ...alt,
});

const offer = z.strictObject({
  layout: z.literal('offer'),
  badge: text,
  title: text,
  details: text,
  price: text.optional(),
  image: ImageRefSchema.optional(),
  cta: text,
  ...alt,
});

const cta = z.strictObject({
  layout: z.literal('cta'),
  /** The brand's logo or its mascot. */
  mark: z.enum(['logo', 'mascot']),
  title: text,
  body: text,
  cta: text,
  ...alt,
});

const textSlide = z.strictObject({
  layout: z.literal('text'),
  kicker: text,
  title: text,
  body: text,
  source: text.optional(),
  ...alt,
});

const testimonial = z.strictObject({
  layout: z.literal('testimonial'),
  /** Supplied by the agency, never written by the AI (§07). */
  quote: text,
  customer: text,
  detail: text,
  photo: ImageRefSchema.optional(),
  ...alt,
});

const photocard = z.strictObject({
  layout: z.literal('photocard'),
  photo: ImageRefSchema,
  headline: text,
  fact: text,
  source: text,
  photoCredit: text,
  ...alt,
});

/** A meme panel: the brand's own image or its mascot, never both, and a label. */
const panel = z.union([
  z.strictObject({ image: ImageRefSchema, label: text }),
  z.strictObject({ mascot: z.literal(true), label: text }),
]);

const meme = z.strictObject({
  layout: z.literal('meme'),
  panels: z.array(panel).min(1).max(2),
  text,
  ...alt,
});

const beforeafter = z.strictObject({
  layout: z.literal('beforeafter'),
  before: ImageRefSchema,
  after: ImageRefSchema,
  beforeLabel: text,
  afterLabel: text,
  caption: text,
  ...alt,
});

export const slideSchemas = {
  cover,
  fact,
  step,
  list,
  quote,
  stat,
  question,
  offer,
  cta,
  text: textSlide,
  testimonial,
  photocard,
  meme,
  beforeafter,
} satisfies Record<LayoutName, z.ZodType>;

export const SlideSchema = z.discriminatedUnion('layout', [
  cover,
  fact,
  step,
  list,
  quote,
  stat,
  question,
  offer,
  cta,
  textSlide,
  testimonial,
  photocard,
  meme,
  beforeafter,
]);

export type Slide = z.infer<typeof SlideSchema>;

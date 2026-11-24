import { parseHighlights, type Post } from '@lzp/core';
import { z } from 'zod';
import { SIZE_NAMES, type SizeName } from '../sizes.ts';
import { targetGraphemes } from './target.ts';

// The fit report (§08 The fit check): per slide and size, the scale the text needed, whether it fits, and for a slide
// that doesn't, each field to shorten with a target length for the AI (`fitFix`, §09). The page measures boxes and
// the rest is made here, in Node: grapheme counts must come from the worker's pinned ICU (§08 Bangla), not from the
// browser's.

/** The smallest scale the fit script goes down to, and the largest. */
export const K_MIN = 0.85;
export const K_MAX = 1;

const FieldSchema = z.strictObject({
  /** A path into the post: `slides[0].title`. */
  field: z
    .string()
    .regex(/^slides\[\d+\]\.[A-Za-z]+$/, 'a path into the post, like slides[0].title'),
  lines: z.int().min(1),
  graphemes: z.int().min(0),
  overflowPx: z.number().min(0),
  targetGraphemes: z.int().min(1),
});

export const FitReportSchema = z.strictObject({
  size: z.enum(SIZE_NAMES),
  /** The slide's place in the post, from 1. */
  slide: z.int().min(1),
  k: z.number().min(K_MIN).max(K_MAX),
  status: z.enum(['pass', 'fail']),
  /** The fields to shorten; none when the slide passes. */
  fields: z.array(FieldSchema),
});

export type FitReport = z.infer<typeof FitReportSchema>;

/**
 * What the fit script measured in the page: the scale it picked, whether the text fits at it, and, when it doesn't,
 * the blocks to shorten by the class they carry (`title`), their lines, the height they need and the height they
 * would have if the text fitted, and how far they stick out.
 */
export const PageFitSchema = z.strictObject({
  k: z.number().min(K_MIN).max(K_MAX),
  fits: z.boolean(),
  fields: z.array(
    z.strictObject({
      name: z.string(),
      lines: z.int().min(1),
      needed: z.number().min(0),
      available: z.number().min(0),
      overflowPx: z.number().min(0),
    }),
  ),
});

export type PageFit = z.infer<typeof PageFitSchema>;

// 'und' like `@lzp/core`'s grapheme counter, so the count is the same on every machine (§08).
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

/** The length of what is drawn: the highlight marks (`*older*`) are not part of it. */
function drawnGraphemes(text: string): number {
  const drawn = parseHighlights(text)
    .segments.map((segment) => segment.text)
    .join('');
  return Array.from(segmenter.segment(drawn)).length;
}

/** What a part of a field says: a text is itself, a text option its text, a picture option nothing (`[]`); else `undefined`. */
function optionText(part: unknown): string[] | undefined {
  if (typeof part === 'string') return [part];
  if (typeof part !== 'object' || part === null) return undefined;
  if ('text' in part && typeof part.text === 'string') return [part.text];
  return 'image' in part ? [] : undefined;
}

/**
 * The report for one slide at one size, from what the page measured. Throws for what is a bug in the caller: a slide
 * that isn't in the post, or a block the page named that the slide has no text for.
 */
export function buildFitReport(
  post: Post,
  slideIndex: number,
  size: SizeName,
  page: PageFit,
): FitReport {
  const slide = post.slides[slideIndex];
  if (slide === undefined) throw new Error(`The post has no slide ${String(slideIndex + 1)}`);
  const texts = new Map<string, unknown>(Object.entries(slide));

  const fields = page.fields.map((block) => {
    const text = texts.get(block.name);
    // A list's `items` are one block to the page, an array of texts to the post: its length is every item's. A
    // question's `options` are the same, but an option may be a picture, which has no text to count
    const parts: unknown[] = typeof text === 'string' ? [text] : Array.isArray(text) ? text : [];
    const strings = parts.flatMap((part) => optionText(part) ?? []);
    if (strings.length === 0 || parts.some((part) => optionText(part) === undefined))
      throw new Error(`The page named the block "${block.name}", but the slide has no such text`);
    const graphemes = strings.reduce((total, part) => total + drawnGraphemes(part), 0);
    return {
      field: `slides[${String(slideIndex)}].${block.name}`,
      lines: block.lines,
      graphemes,
      overflowPx: block.overflowPx,
      targetGraphemes: targetGraphemes(graphemes, block.available, block.needed),
    };
  });

  return FitReportSchema.parse({
    size,
    slide: slideIndex + 1,
    k: page.k,
    status: page.fits ? 'pass' : 'fail',
    fields,
  });
}

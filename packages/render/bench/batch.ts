import { SIZE_NAMES, type Post, type SizeName, type Slide } from '@lzp/core';
import { FONT_MANIFEST } from '../src/fonts/library.ts';
import type { RenderKit } from '../src/kit.ts';
import {
  SAMPLE_COVER,
  SAMPLE_CTA,
  SAMPLE_FACT,
  SAMPLE_LIST,
  SAMPLE_OFFER,
  SAMPLE_PUBLIC_QUOTE,
  SAMPLE_QUESTION,
  SAMPLE_QUESTION_IMAGES,
  SAMPLE_QUOTE,
  SAMPLE_STAT,
  SAMPLE_STEP,
  type Lang,
} from '../src/layouts/samples.ts';
import { testBanglaPost, testKit, testPost } from '../src/page/test-fixtures.ts';

// The sample batch: what a 12-post batch asks of the renderer (§08 "When renders happen"). 12 posts, each of 2 slides at
// all 5 sizes, is 120 renders; the posts are English and Bangla in the Clean and Playful looks, 3 of each, and their
// slides run through the layouts the app draws. The slide text is the layout specs' own sample content (made-up
// brands), so the numbers can be set against those specs' renders.

const LOOKS = ['clean', 'playful'] as const;
const LANGS = ['en', 'bn'] as const satisfies readonly Lang[];
const POSTS_PER_COMBINATION = 3;
const SLIDES_PER_POST = 2;

/** One slide render: the post it belongs to, the slide, the size, and the kit the post's look is drawn in. */
export type BatchJob = {
  postId: string;
  post: Post;
  slide: Slide;
  size: SizeName;
  kit: RenderKit;
};

const SAMPLES: readonly Record<Lang, Slide>[] = [
  SAMPLE_COVER,
  SAMPLE_STEP,
  SAMPLE_CTA,
  SAMPLE_FACT,
  SAMPLE_LIST,
  SAMPLE_QUOTE,
  SAMPLE_STAT,
  SAMPLE_QUESTION,
  SAMPLE_OFFER,
  SAMPLE_PUBLIC_QUOTE,
  SAMPLE_QUESTION_IMAGES,
];

/** A made-up brand's colours in the look's own font pair, with a mascot (the layouts that draw one). */
function kitFor(look: (typeof LOOKS)[number]): RenderKit {
  const fonts = FONT_MANIFEST.looks[look];
  if (fonts === undefined) throw new Error(`The font manifest has no pair for the ${look} look`);
  return testKit({
    colors: {
      primary: '#1e6b74',
      accent: '#f2a65a',
      background: '#ffffff',
      ink: '#1d2b36',
      extras: [],
    },
    fonts,
    mascot: 'mascot_1',
  });
}

/**
 * The 12 posts' 120 renders. They are ordered slide by slide, then size by size, then post by post, so the start of
 * the list already holds every size, language and look: a short run (CI's 50 renders) is a fair sample of the whole.
 */
export function sampleBatch(): BatchJob[] {
  const posts: { postId: string; post: Post; kit: RenderKit }[] = [];
  for (const look of LOOKS)
    for (const lang of LANGS)
      for (let n = 0; n < POSTS_PER_COMBINATION; n++) {
        const index = posts.length;
        const slides = Array.from({ length: SLIDES_PER_POST }, (_, i) => {
          const sample = SAMPLES[(index * SLIDES_PER_POST + i) % SAMPLES.length];
          const slide = sample?.[lang];
          if (slide === undefined) throw new Error('A sample batch slide is missing');
          return slide;
        });
        const base = lang === 'en' ? testPost() : testBanglaPost();
        const post: Post = {
          ...base,
          kind: 'carousel',
          look: { name: look, switches: {} },
          slides,
        };
        posts.push({ postId: `bench-${String(index + 1)}`, post, kit: kitFor(look) });
      }

  const jobs: BatchJob[] = [];
  for (let slideIndex = 0; slideIndex < SLIDES_PER_POST; slideIndex++)
    for (const size of SIZE_NAMES)
      for (const { postId, post, kit } of posts) {
        const slide = post.slides[slideIndex];
        if (slide !== undefined) jobs.push({ postId, post, slide, size, kit });
      }
  return jobs;
}

/** The first `renders` jobs of the batch, starting it again from its first job when a run is longer than it. */
export function takeRenders(batch: readonly BatchJob[], renders: number): BatchJob[] {
  if (batch.length === 0) throw new Error('The batch has no renders');
  return Array.from({ length: renders }, (_, i) => {
    const job = batch[i % batch.length];
    if (job === undefined) throw new Error('unreachable');
    return job;
  });
}

import type { Post, SizeName, Slide } from '@lzp/core';
import { CLEAN_FONTS } from '../looks/clean/index.ts';
import type { RenderKit } from '../kit.ts';
import { buildSlideWithWarnings } from '../page/build-slide.ts';
import { testBanglaPost, testKit, testPost } from '../page/test-fixtures.ts';
import type { Lang } from './samples.ts';

// What the layout specs share: the Clean look's sample kit, a post around a slide, the HTML `buildSlide` makes of it and
// a few ways to read that HTML. Only specs import this.

export const KIT: RenderKit = testKit({
  colors: {
    primary: '#1e6b74',
    accent: '#f2a65a',
    background: '#ffffff',
    ink: '#1d2b36',
    extras: [],
  },
  fonts: CLEAN_FONTS,
  mascot: 'mascot_1',
});

const postWith = (slide: Slide, lang: Lang): Post => ({
  ...(lang === 'en' ? testPost() : testBanglaPost()),
  slides: [slide],
});

export const build = (slide: Slide, size: SizeName, lang: Lang = 'en', kit: RenderKit = KIT) =>
  buildSlideWithWarnings(postWith(slide, lang), slide, size, kit);

/** The elements with a class, by tag, in document order: `<p class="kicker">…</p>` found by `kicker`. */
const classes = (html: string): string[] =>
  [
    ...html.matchAll(/<(?:main|div|p|h1|ul|li|img|header|footer|span)\b[^>]*class="([^"]*)"/g),
  ].flatMap((match) => (match[1] ?? '').split(' '));
export const has = (html: string, name: string): boolean => classes(html).includes(name);

/** The classes of the blocks inside the text area, in order (a column counts as one; the photo is inside its box). */
export function textAreaBlocks(html: string): string[] {
  const start = html.indexOf('class="text-area"');
  const end = html.includes('<footer') ? html.indexOf('<footer') : html.length;
  return [...html.slice(start, end).matchAll(/<(?:div|p|h1|ul|img)\b[^>]*class="([^"]*)"/g)]
    .map((match) => match[1] ?? '')
    .filter((name) => name !== 'photo' && name !== 'text-area');
}

import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Post, SizeName, Slide } from '../../packages/core/src/index.ts';
import { createRenderer, type RenderAsset } from '../../packages/render/src/browser/index.ts';
import { FONT_MANIFEST } from '../../packages/render/src/fonts/library.ts';
import type { RenderKit } from '../../packages/render/src/kit.ts';
import {
  LONG_BODY,
  LONGEST_COVER_TITLE,
  SAMPLE_COVER,
  SAMPLE_CTA,
  SAMPLE_STEP,
  type Lang,
} from '../../packages/render/src/layouts/samples.ts';
import { testBanglaPost, testKit, testPost } from '../../packages/render/src/page/test-fixtures.ts';
import { SIZE_NAMES } from '../../packages/render/src/sizes.ts';
import { renderPostSlide } from './slides.ts';

// The cover, cta and step layouts in a real Chromium (#338; §07 Layouts, §08 Sizes and arrangements and The fit
// check). These run in CI's services job, the `render` Playwright project: each layout in the Clean look at every
// size, in English and Bangla, through the page runner and the fit script. Each drawn slide is kept as
// `<layout>-<lang>-<size>.png` in the test's output folder, which CI uploads as the `render-output` artifact for
// Iris's review.

const fonts = FONT_MANIFEST.looks.clean;
if (fonts === undefined) throw new Error('no Clean fonts in the manifest');

/** A sample kit of our own ("Stillwater Physio" and "Meghla Cafe" are made up), in Clean's own font pair, with a mascot. */
const KIT: RenderKit = testKit({
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

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const image = (key: string): RenderAsset => ({
  kind: 'image',
  key,
  contentType: 'image/png',
  data: PIXEL,
});
const ASSETS = ['logo_light_1', 'photo_sample_1', 'mascot_1'].map(image);

/** The Clean look's post in `lang` with `slide` twice, so the page number is drawn too. */
function postWith(lang: Lang, slide: Slide): Post {
  const post = lang === 'en' ? testPost() : testBanglaPost();
  return { ...post, look: { name: 'clean', switches: {} }, slides: [slide, slide] };
}

const SAMPLES = [
  ['cover', SAMPLE_COVER],
  ['step', SAMPLE_STEP],
  ['cta', SAMPLE_CTA],
] as const;

/** Draws one slide in a fresh renderer, and keeps its PNG for the review. */
async function draw(post: Post, size: SizeName, name: string) {
  const renderer = createRenderer({ log: () => undefined });
  try {
    const drawn = await renderPostSlide(renderer, post, size, ASSETS, 0, KIT);
    await writeFile(test.info().outputPath(`${name}.png`), drawn.png);
    return drawn;
  } finally {
    await renderer.close();
  }
}

test.describe('typical content passes the fit check in the Clean look, at every size', () => {
  for (const [layout, samples] of SAMPLES)
    for (const lang of ['en', 'bn'] as const)
      for (const size of SIZE_NAMES)
        test(`${layout}, ${lang}, ${size}`, async () => {
          const drawn = await draw(
            postWith(lang, samples[lang]),
            size,
            `${layout}-${lang}-${size}`,
          );
          expect(drawn.report).toMatchObject({ size, slide: 1, status: 'pass', fields: [] });
          expect(drawn.warnings).toEqual([]);
          expect(drawn.render.errors).toEqual([]); // no font fell back, every image loaded
          expect(drawn.render.blocked).toEqual([]);
        });
});

test.describe('the longest allowed text fits, or fails naming the field and a target', () => {
  for (const lang of ['en', 'bn'] as const)
    for (const size of SIZE_NAMES)
      test(`cover with an 8-word title and a long body, ${lang}, ${size}`, async () => {
        const slide: Slide = {
          ...SAMPLE_COVER[lang],
          title: LONGEST_COVER_TITLE[lang],
          body: LONG_BODY[lang],
        };
        const { report } = await draw(postWith(lang, slide), size, `cover-longest-${lang}-${size}`);
        if (report.status === 'pass') {
          expect(report.fields).toEqual([]);
          return;
        }
        // Not a pass: it says which text to cut and to how many graphemes, never a bare failure
        expect(report.k).toBe(0.85);
        expect(report.fields.length).toBeGreaterThan(0);
        for (const field of report.fields) {
          expect(field.field).toMatch(/^slides\[0\]\.(kicker|title|body)$/);
          expect(field.targetGraphemes).toBeGreaterThanOrEqual(1);
          expect(field.targetGraphemes).toBeLessThan(field.graphemes);
        }
      });

  for (const [layout, samples] of [
    ['step', SAMPLE_STEP],
    ['cta', SAMPLE_CTA],
  ] as const)
    for (const lang of ['en', 'bn'] as const)
      for (const size of SIZE_NAMES)
        test(`${layout} with a long title and body, ${lang}, ${size}`, async () => {
          const slide: Slide = {
            ...samples[lang],
            title: LONG_BODY[lang],
            body: LONG_BODY[lang],
          };
          const { report } = await draw(
            postWith(lang, slide),
            size,
            `${layout}-longest-${lang}-${size}`,
          );
          if (report.status === 'pass') return;
          expect(report.fields.length).toBeGreaterThan(0);
          for (const field of report.fields) {
            expect(field.field).toMatch(/^slides\[0\]\.(title|body)$/);
            expect(field.targetGraphemes).toBeLessThan(field.graphemes);
          }
        });
});

test.describe('missing optional fields render cleanly', () => {
  for (const lang of ['en', 'bn'] as const)
    for (const size of SIZE_NAMES) {
      test(`cover with no body, image or sticker, ${lang}, ${size}`, async () => {
        const { kicker, title, alt, layout } = SAMPLE_COVER[lang];
        const slide: Slide = { layout, kicker, title, alt };
        const drawn = await draw(postWith(lang, slide), size, `cover-bare-${lang}-${size}`);
        expect(drawn.report).toMatchObject({ status: 'pass', fields: [] });
        expect(drawn.warnings).toEqual([]);
        expect(drawn.render.errors).toEqual([]);
      });

      test(`cover with only an image, ${lang}, ${size}`, async () => {
        const { kicker, title, alt, layout, image: photo } = SAMPLE_COVER[lang];
        const slide: Slide = { layout, kicker, title, alt, image: photo };
        const drawn = await draw(postWith(lang, slide), size, `cover-image-${lang}-${size}`);
        expect(drawn.report).toMatchObject({ status: 'pass', fields: [] });
        expect(drawn.render.errors).toEqual([]);
      });

      test(`cta with the kit's mascot missing, ${lang}, ${size}`, async () => {
        const renderer = createRenderer({ log: () => undefined });
        try {
          const kit = testKit({ ...KIT, mascot: undefined });
          const slide: Slide = { ...SAMPLE_CTA[lang], mark: 'mascot' };
          const drawn = await renderPostSlide(
            renderer,
            postWith(lang, slide),
            size,
            ASSETS,
            0,
            kit,
          );
          expect(drawn.report).toMatchObject({ status: 'pass', fields: [] });
          expect(drawn.render.errors).toEqual([]);
        } finally {
          await renderer.close();
        }
      });
    }
});

import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Post, SizeName, Slide } from '../../packages/core/src/index.ts';
import { createRenderer, type RenderAsset } from '../../packages/render/src/browser/index.ts';
import { FONT_MANIFEST } from '../../packages/render/src/fonts/library.ts';
import type { RenderKit } from '../../packages/render/src/kit.ts';
import {
  LONG_BODY,
  LONGEST_COVER_TITLE,
  LONGEST_LIST_ITEMS,
  SAMPLE_COVER,
  SAMPLE_CTA,
  SAMPLE_FACT,
  SAMPLE_LIST,
  SAMPLE_PUBLIC_QUOTE,
  SAMPLE_QUOTE,
  SAMPLE_STEP,
  type Lang,
} from '../../packages/render/src/layouts/samples.ts';
import { testBanglaPost, testKit, testPost } from '../../packages/render/src/page/test-fixtures.ts';
import { SIZE_NAMES } from '../../packages/render/src/sizes.ts';
import { renderPostSlide } from './slides.ts';

// The cover, cta, step, fact, list and quote layouts in a real Chromium (#338, #339; §07 Layouts, §08 Sizes and arrangements and The fit
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
  ['fact', SAMPLE_FACT],
  ['list', SAMPLE_LIST],
  ['quote', SAMPLE_QUOTE],
  ['quote-public', SAMPLE_PUBLIC_QUOTE],
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
    ['fact', SAMPLE_FACT],
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

test.describe('the longest quote and the longest list fit, or fail naming the field and a target', () => {
  for (const lang of ['en', 'bn'] as const)
    for (const size of SIZE_NAMES) {
      test(`quote with a long quote, ${lang}, ${size}`, async () => {
        const slide: Slide = { ...SAMPLE_PUBLIC_QUOTE[lang], quote: LONG_BODY[lang] };
        const { report } = await draw(postWith(lang, slide), size, `quote-longest-${lang}-${size}`);
        if (report.status === 'pass') {
          expect(report.fields).toEqual([]);
          return;
        }
        expect(report.k).toBe(0.85);
        expect(report.fields.length).toBeGreaterThan(0);
        for (const field of report.fields) {
          expect(field.field).toMatch(/^slides\[0\]\.(quote|person|role|source)$/);
          expect(field.targetGraphemes).toBeLessThan(field.graphemes);
        }
      });
    }
});

test.describe('the longest list: five items of eight words (§07)', () => {
  // A list's items are one block to the fit check, named `items` (`slides[0].items`). Five items of long words do not
  // fit every size: a size either passes with nothing to fix, or fails naming the field to shorten, with a target.
  for (const lang of ['en', 'bn'] as const)
    test(`names the items to shorten where they do not fit, ${lang}`, async () => {
      const slide: Slide = {
        ...SAMPLE_LIST[lang],
        title: LONGEST_COVER_TITLE[lang],
        items: LONGEST_LIST_ITEMS[lang],
      };
      const reports = [];
      for (const size of SIZE_NAMES) {
        const { report } = await draw(postWith(lang, slide), size, `list-longest-${lang}-${size}`);
        reports.push(report);
      }

      for (const report of reports) {
        if (report.status === 'pass') {
          expect(report.fields).toEqual([]);
          continue;
        }
        expect(report.k).toBe(0.85);
        expect(report.fields.length).toBeGreaterThan(0);
        for (const field of report.fields) {
          expect(field.field).toMatch(/^slides\[0\]\.(title|items)$/);
          expect(field.targetGraphemes).toBeGreaterThanOrEqual(1);
          expect(field.targetGraphemes).toBeLessThan(field.graphemes);
        }
      }
      const failed = reports.filter((report) => report.status === 'fail');
      expect(failed.length).toBeGreaterThan(0);
      const named = failed.flatMap((report) =>
        report.fields.filter((field) => field.field === 'slides[0].items'),
      );
      expect(named.length).toBeGreaterThan(0);
    });
});

test.describe('a source, a person or a role that is too wide is named by its own field', () => {
  // One word, four times over: wider than the widest column at every size, at 28 px and at body size alike
  const TOO_WIDE: Record<Lang, string> = {
    en: 'Supercalifragilisticexpialidociousappointmentsbookingtodayplease'.repeat(4),
    bn: 'অনুগ্রহপূর্বকআজকেইআমাদেরসঙ্গেযোগাযোগকরেএকটিবুকিংনিশ্চিতকরুন'.repeat(4),
  };

  for (const lang of ['en', 'bn'] as const)
    for (const size of SIZE_NAMES) {
      const cases: [string, Slide, string][] = [
        ['fact', { ...SAMPLE_FACT[lang], source: TOO_WIDE[lang] }, 'source'],
        ['quote', { ...SAMPLE_PUBLIC_QUOTE[lang], source: TOO_WIDE[lang] }, 'source'],
        ['quote', { ...SAMPLE_QUOTE[lang], person: TOO_WIDE[lang] }, 'person'],
        ['quote', { ...SAMPLE_QUOTE[lang], role: TOO_WIDE[lang] }, 'role'],
      ];
      for (const [layout, slide, field] of cases)
        test(`${layout} with a ${field} of one long word, ${lang}, ${size}`, async () => {
          const { report } = await draw(
            postWith(lang, slide),
            size,
            `${layout}-${field}-wide-${lang}-${size}`,
          );
          expect(report.status).toBe('fail');
          const named = report.fields.find((candidate) => candidate.field === `slides[0].${field}`);
          expect(named).toBeDefined();
          expect(named?.overflowPx).toBeGreaterThan(0);
          expect(named?.targetGraphemes).toBeGreaterThanOrEqual(1);
          expect(named?.targetGraphemes).toBeLessThan(named?.graphemes ?? 0);
        });
    }
});

test.describe('a call to action or a sticker that is too wide is named by its own field', () => {
  // One word, twice over: wider than the widest column at every size even at the smallest scale (a single copy
  // fits the pin's 880 px, and Bangla's landscape column, once the fit script has lowered `--k` to 0.85)
  const CTA_TOO_WIDE: Record<Lang, string> = {
    en: 'Supercalifragilisticexpialidociousappointmentsbookingtodayplease'.repeat(2),
    bn: 'অনুগ্রহপূর্বকআজকেইআমাদেরসঙ্গেযোগাযোগকরেএকটিবুকিংনিশ্চিতকরুন'.repeat(2),
  };
  const STICKER_TOO_WIDE: Record<Lang, string> = {
    en: 'Limited time only: our big launch special offer ends this very Sunday at midnight, so hurry',
    bn: 'সীমিত সময়ের জন্য আমাদের বিশেষ উদ্বোধনী ছাড় চলছে শুধু এই সপ্তাহে, তাই আজই চলে আসুন আমাদের দোকানে',
  };

  for (const lang of ['en', 'bn'] as const)
    for (const size of SIZE_NAMES) {
      test(`cta with a call to action of one long word, ${lang}, ${size}`, async () => {
        const slide: Slide = { ...SAMPLE_CTA[lang], cta: CTA_TOO_WIDE[lang] };
        const { report } = await draw(postWith(lang, slide), size, `cta-wide-${lang}-${size}`);
        expect(report.status).toBe('fail');
        const named = report.fields.find((field) => field.field === 'slides[0].cta');
        expect(named).toBeDefined();
        expect(named?.overflowPx).toBeGreaterThan(0);
        expect(named?.targetGraphemes).toBeGreaterThanOrEqual(1);
        expect(named?.targetGraphemes).toBeLessThan(named?.graphemes ?? 0);
      });

      test(`cover with a sticker of one long line, ${lang}, ${size}`, async () => {
        const slide: Slide = { ...SAMPLE_COVER[lang], sticker: STICKER_TOO_WIDE[lang] };
        const { report } = await draw(
          postWith(lang, slide),
          size,
          `cover-sticker-wide-${lang}-${size}`,
        );
        expect(report.status).toBe('fail');
        const named = report.fields.find((field) => field.field === 'slides[0].sticker');
        expect(named).toBeDefined();
        expect(named?.overflowPx).toBeGreaterThan(0);
        expect(named?.targetGraphemes).toBeLessThan(named?.graphemes ?? 0);
      });
    }
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

      test(`fact with no image, ${lang}, ${size}`, async () => {
        const { layout, kicker, title, body, source, alt } = SAMPLE_FACT[lang];
        const slide: Slide = { layout, kicker, title, body, source, alt };
        const drawn = await draw(postWith(lang, slide), size, `fact-bare-${lang}-${size}`);
        expect(drawn.report).toMatchObject({ status: 'pass', fields: [] });
        expect(drawn.warnings).toEqual([]);
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

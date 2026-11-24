import { SIZE_NAMES, SlideSchema, type Slide } from '@lzp/core';
import { describe, expect, it } from 'vitest';
import { checkPairs, pairsFor, registeredLayouts } from '../contrast/pairs.ts';
import { testKit } from '../page/test-fixtures.ts';
import { SIZES, SMALL_PRINT_PX } from '../sizes.ts';
import {
  LONG_BODY,
  LONGEST_COVER_TITLE,
  SAMPLE_COVER,
  SAMPLE_CTA,
  SAMPLE_STEP,
} from './samples.ts';
import { build, has, KIT, textAreaBlocks } from './test-helpers.ts';

// The cover, cta and step layouts (§07 Layouts, §08 Sizes and arrangements). These read the HTML `buildSlide` makes;
// the browser specs in `tests/render/` draw it and run the fit check.

const LAYOUTS = [
  ['cover', SAMPLE_COVER],
  ['step', SAMPLE_STEP],
  ['cta', SAMPLE_CTA],
] as const;

describe('the samples are valid slides', () => {
  it.each(['en', 'bn'] as const)('%s: each passes its own schema', (lang) => {
    for (const slide of [SAMPLE_COVER[lang], SAMPLE_STEP[lang], SAMPLE_CTA[lang]])
      expect(SlideSchema.safeParse(slide).success).toBe(true);
  });

  it.each(['en', 'bn'] as const)(
    '%s: the longest cover title is the 8 words §07 allows',
    (lang) => {
      const slide = { ...SAMPLE_COVER[lang], title: LONGEST_COVER_TITLE[lang] };
      expect(SlideSchema.safeParse(slide).success).toBe(true);
      expect(SlideSchema.safeParse({ ...slide, title: `${slide.title} more` }).success).toBe(false);
    },
  );
});

describe.each(LAYOUTS)('the %s layout', (layout, samples) => {
  it.each(SIZE_NAMES)('%s: is drawn by buildSlide inside the margins', (size) => {
    const { html, warnings } = build(samples.en, size);
    expect(html).toContain(`<main class="slide layout-${layout}">`);
    expect(html).toContain('class="text-area"');
    expect(html).toContain(`size-${size}`);
    expect(warnings).toEqual([]);
  });

  it('escapes the text it is given: nothing a post says is ever HTML', () => {
    const hostile = { ...samples.en, title: 'Hi <img src=x onerror=alert(1)> *there*' };
    const { html } = build(hostile, 'portrait');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('<mark class="hl">there</mark>');
  });

  it('is stacked in every size but landscape, and two columns there (text left, image right)', () => {
    for (const size of SIZE_NAMES) {
      const { html } = build(samples.en, size);
      expect(has(html, 'col-text')).toBe(SIZES[size].arrangement === 'columns');
    }
  });

  it.each(['en', 'bn'] as const)('%s: puts the highlight in a mark, in the title', (lang) => {
    const { html } = build(samples[lang], 'portrait', lang);
    expect(/<h1 class="title">[^]*<mark class="hl">[^<]+<\/mark>[^]*<\/h1>/.test(html)).toBe(true);
  });
});

describe('the cover layout', () => {
  const cover = SAMPLE_COVER.en;
  const bare = { ...cover } as Partial<typeof cover>;
  delete bare.body;
  delete bare.image;
  delete bare.sticker;

  it.each(SIZE_NAMES.filter((size) => SIZES[size].arrangement === 'stacked'))(
    '%s: stacks sticker, kicker, title, body and the image one under another',
    (size) => {
      const { html } = build(cover, size);
      expect(textAreaBlocks(html)).toEqual([
        'sticker small-print',
        'kicker',
        'title',
        'body',
        'image-box',
      ]);
    },
  );

  it('landscape: the text is the left column and the image box the right', () => {
    const { html } = build(cover, 'landscape');
    expect(textAreaBlocks(html)).toEqual([
      'col col-text',
      'sticker small-print',
      'kicker',
      'title',
      'body',
      'image-box',
    ]);
    expect(html.indexOf('class="col col-text"')).toBeLessThan(html.indexOf('class="image-box"'));
  });

  it.each(SIZE_NAMES)('%s: leaves no hole when body, image and sticker are missing', (size) => {
    const { html } = build(bare as Slide, size);
    for (const gone of ['body', 'image-box', 'sticker', 'photo'])
      expect(has(html, gone)).toBe(false);
    expect(has(html, 'kicker') && has(html, 'title')).toBe(true);
    expect(html).not.toContain('<img class="photo"');
  });

  it('draws the image through the job assets, as an img inside the image box, filling it', () => {
    const { html } = build(cover, 'portrait');
    expect(html).toMatch(
      /<div class="image-box"><img src="lzp-asset:image\/photo_sample_1" alt="" class="photo" width="100%" height="100%"\/><\/div>/,
    );
  });

  it('gives a landscape image a height of its own, since its column is as tall as its content', () => {
    const { html } = build(cover, 'landscape');
    expect(html).toMatch(/class="photo" width="100%" height="\d+"/);
  });

  it('warns, and draws no image, for an image that is not an asset', () => {
    const slide = { ...cover, image: { asset: 'https://example.com/a.jpg' } };
    const { html, warnings } = build(slide, 'portrait');
    expect(has(html, 'image-box')).toBe(false);
    expect(warnings).toMatchObject([
      { code: 'image-not-an-asset', field: 'slides[0].image.asset' },
    ]);
  });

  it('reads the sticker as plain text', () => {
    const { html } = build({ ...cover, sticker: 'Win <b>big</b>' }, 'portrait');
    expect(html).toContain('<p class="sticker small-print">Win &lt;b&gt;big&lt;/b&gt;</p>');
  });
});

describe('the step layout', () => {
  it.each(SIZE_NAMES.filter((size) => SIZES[size].arrangement === 'stacked'))(
    '%s: stacks the step label, the image, the title and the body',
    (size) => {
      const { html } = build(SAMPLE_STEP.en, size);
      expect(textAreaBlocks(html)).toEqual([
        'step-label small-print',
        'image-box',
        'title',
        'body',
      ]);
    },
  );

  it('landscape: label, title and body are the left column, the image the right', () => {
    const { html } = build(SAMPLE_STEP.en, 'landscape');
    expect(textAreaBlocks(html)).toEqual([
      'col col-text',
      'step-label small-print',
      'title',
      'body',
      'image-box',
    ]);
  });

  it('says which step it is, in the language of the post and its digits', () => {
    expect(build(SAMPLE_STEP.en, 'portrait').html).toContain('Step 2 of 4');
    expect(build(SAMPLE_STEP.bn, 'portrait', 'bn').html).toContain('ধাপ ২ / ৪');
  });

  it('has no kicker: the step label is the only line above the title', () => {
    expect(has(build(SAMPLE_STEP.en, 'portrait').html, 'kicker')).toBe(false);
  });
});

describe('the cta layout', () => {
  it.each(SIZE_NAMES.filter((size) => SIZES[size].arrangement === 'stacked'))(
    '%s: stacks the mark, the title, the body and the call to action',
    (size) => {
      const { html } = build(SAMPLE_CTA.en, size);
      expect(textAreaBlocks(html)).toEqual(['cta-mark', 'title', 'body', 'cta-line']);
    },
  );

  it('landscape: everything is the left column and the right is left to the text, no empty column', () => {
    const { html } = build(SAMPLE_CTA.en, 'landscape');
    expect(textAreaBlocks(html)).toEqual(['col col-text', 'cta-mark', 'title', 'body', 'cta-line']);
    expect(has(html, 'image-box')).toBe(false);
  });

  it('draws the logo as the mark, once: the corner logo is not repeated', () => {
    const { html } = build(SAMPLE_CTA.en, 'portrait');
    expect(html.match(/<img [^>]*logo_light_1/g)).toHaveLength(1);
    expect(html).toMatch(/<img src="lzp-asset:image\/logo_light_1" alt="" class="cta-mark"/);
    expect(has(html, 'header')).toBe(false);
    expect(has(html, 'logo')).toBe(false);
  });

  it('draws the mascot as the mark when the kit has one, and keeps the corner logo', () => {
    const { html } = build(SAMPLE_CTA.bn, 'portrait', 'bn');
    expect(html).toMatch(/<img src="lzp-asset:image\/mascot_1" alt="" class="cta-mark"/);
    expect(html).toContain('lzp-asset:image/logo_light_1');
  });

  it('falls back to the logo when the mascot is asked for and the kit has none', () => {
    const kit = testKit({ ...KIT, mascot: undefined });
    const { html } = build(SAMPLE_CTA.bn, 'portrait', 'bn', kit);
    expect(html).toMatch(/<img src="lzp-asset:image\/logo_light_1" alt="" class="cta-mark"/);
    expect(html.match(/<img [^>]*logo_light_1/g)).toHaveLength(1);
  });

  it('puts the call to action in a highlight, as text', () => {
    const { html } = build({ ...SAMPLE_CTA.en, cta: 'Go <now>' }, 'portrait');
    expect(html).toContain('<p class="cta-line"><mark class="hl">Go &lt;now&gt;</mark></p>');
  });
});

describe('the logo switch', () => {
  it('still draws the corner logo of a cover, at the top for a pin', () => {
    expect(build(SAMPLE_COVER.en, 'pin').html).toContain('<header class="header">');
    expect(build(SAMPLE_COVER.en, 'portrait').html).toContain('<footer class="footer">');
  });
});

describe('long text is drawn whole', () => {
  it('keeps the whole of the longest text in every field, never cut by the builder', () => {
    const cover = { ...SAMPLE_COVER.en, title: LONGEST_COVER_TITLE.en, body: LONG_BODY.en };
    const { html } = build(cover, 'story');
    expect(html).toContain('ergonomics recovery');
    expect(html).toContain(LONG_BODY.en);
  });
});

describe('the contrast pairs they register (§07 Contrast)', () => {
  it('registers cover, cta and step', () => {
    expect(registeredLayouts()).toEqual(expect.arrayContaining(['cover', 'cta', 'step']));
  });

  describe.each(LAYOUTS)('%s', (layout) => {
    it.each(SIZE_NAMES)('%s: every pair passes with the Clean look sample kit', (size) => {
      const results = checkPairs(KIT, 'clean', pairsFor(layout, KIT, 'clean', size));
      expect(results.length).toBeGreaterThan(0);
      expect(results.filter((result) => !result.passes)).toEqual([]);
    });

    it.each(SIZE_NAMES)('%s: declares the title as the headline and body at its floor', (size) => {
      const pairs = pairsFor(layout, KIT, 'clean', size);
      expect(pairs.filter((pair) => pair.headline === true).map((pair) => pair.name)).toContain(
        `${layout}: title`,
      );
      const body = pairs.find((pair) => pair.name === `${layout}: body`);
      expect(body?.px).toBeGreaterThanOrEqual(SIZES[size].bodyFloor);
      for (const pair of pairs.filter((candidate) => candidate.name.includes('small print')))
        expect(pair.px).toBe(SMALL_PRINT_PX);
      for (const pair of pairs) expect(pair.width).toBe(SIZES[size].width);
    });
  });

  it('judges a title pair at its real, smallest size: the title is 3:1 at 48 px at 1080 and over', () => {
    const portrait = pairsFor('cover', KIT, 'clean', 'portrait');
    const landscape = pairsFor('cover', KIT, 'clean', 'landscape');
    expect(portrait.find((pair) => pair.name === 'cover: title')?.px).toBeCloseTo(96 * 0.85);
    expect(landscape.find((pair) => pair.name === 'cover: title')?.px).toBeCloseTo(60 * 0.85);
  });

  it('declares no photo pair: none of the three draws text over a photo', () => {
    for (const [layout] of LAYOUTS)
      for (const size of SIZE_NAMES)
        for (const pair of pairsFor(layout, KIT, 'clean', size))
          expect(pair.on).not.toEqual({ photo: true });
  });
});

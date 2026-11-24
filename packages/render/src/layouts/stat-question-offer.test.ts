import { SIZE_NAMES, SlideSchema, type Slide } from '@lzp/core';
import { describe, expect, it } from 'vitest';
import { checkPairs, pairsFor, registeredLayouts } from '../contrast/pairs.ts';
import { K_MIN } from '../fit/report.ts';
import { SIZES, SMALL_PRINT_PX } from '../sizes.ts';
import {
  bareOffer,
  LONGEST_OPTIONS,
  SAMPLE_OFFER,
  SAMPLE_QUESTION,
  SAMPLE_QUESTION_IMAGES,
  SAMPLE_STAT,
} from './samples.ts';
import { build, has, KIT, textAreaBlocks } from './test-helpers.ts';

// The stat, question and offer layouts (§07 Layouts, §08 Sizes and arrangements). These read the HTML `buildSlide`
// makes; the browser specs in `tests/render/` draw it and run the fit check.

const STACKED = SIZE_NAMES.filter((size) => SIZES[size].arrangement === 'stacked');
const LAYOUTS = [
  ['stat', SAMPLE_STAT],
  ['question', SAMPLE_QUESTION],
  ['offer', SAMPLE_OFFER],
] as const;

describe('the samples are valid slides', () => {
  it.each(['en', 'bn'] as const)('%s: each passes its own schema', (lang) => {
    for (const slide of [
      SAMPLE_STAT[lang],
      SAMPLE_QUESTION[lang],
      SAMPLE_QUESTION_IMAGES[lang],
      SAMPLE_OFFER[lang],
      bareOffer(lang),
    ])
      expect(SlideSchema.safeParse(slide).success).toBe(true);
  });

  it.each(['en', 'bn'] as const)('%s: the longest options are the 4 §07 allows', (lang) => {
    const options = LONGEST_OPTIONS[lang].map((text) => ({ text }));
    expect(options).toHaveLength(4);
    const slide = { ...SAMPLE_QUESTION[lang], options };
    expect(SlideSchema.safeParse(slide).success).toBe(true);
    expect(
      SlideSchema.safeParse({ ...slide, options: [...options, { text: 'a fifth' }] }).success,
    ).toBe(false);
  });
});

describe.each(LAYOUTS)('the %s layout', (layout, samples) => {
  it.each(SIZE_NAMES)('%s: is drawn by buildSlide inside the margins', (size) => {
    const { html, warnings } = build(samples.en, size);
    expect(html).toContain(`<main class="slide layout-${layout}">`);
    expect(html).toContain('class="text-area"');
    expect(html).toContain(`size-${size}`);
    expect(warnings).toEqual([]);
  });

  it('is stacked in every size but landscape, and in two columns there', () => {
    for (const size of SIZE_NAMES) {
      const { html } = build(samples.en, size);
      expect(has(html, 'col-text')).toBe(SIZES[size].arrangement === 'columns');
    }
  });

  it.each(['en', 'bn'] as const)('%s: draws every text the slide has', (lang) => {
    const { html } = build(samples[lang], 'portrait', lang);
    const texts: string[] = [];
    for (const value of Object.values(samples[lang])) {
      if (typeof value === 'string') texts.push(value);
    }
    // `layout` and `alt` are not drawn; the rest of the strings are, once the highlight marks are taken out
    for (const text of texts.filter((t) => t !== layout && t !== samples[lang].alt))
      expect(html).toContain(text.replaceAll('*', '').replace(/&/g, '&amp;'));
  });
});

describe('the stat layout', () => {
  it.each(STACKED)('%s: stacks the number, the label and the source', (size) => {
    const { html } = build(SAMPLE_STAT.en, size);
    expect(textAreaBlocks(html)).toEqual(['stat-number', 'stat-label', 'source small-print']);
  });

  it('landscape: the number is the left column, the label and the source the right', () => {
    const { html } = build(SAMPLE_STAT.en, 'landscape');
    expect(textAreaBlocks(html)).toEqual([
      'col col-text',
      'stat-number',
      'col col-detail',
      'stat-label',
      'source small-print',
    ]);
  });

  it.each(['en', 'bn'] as const)(
    '%s: always draws the source, with its label in the language',
    (lang) => {
      const { html } = build(SAMPLE_STAT[lang], 'portrait', lang);
      const label = lang === 'en' ? 'Source:' : 'সূত্র:';
      expect(html).toContain(
        `<p class="source small-print">${label} ${SAMPLE_STAT[lang].source}</p>`,
      );
    },
  );

  it('reads the number and the label as plain text', () => {
    const slide = { ...SAMPLE_STAT.en, number: '<b>68</b>%', label: 'a <i>fact</i>' };
    const { html } = build(slide, 'portrait');
    expect(html).toContain('<p class="stat-number">&lt;b&gt;68&lt;/b&gt;%</p>');
    expect(html).toContain('a &lt;i&gt;fact&lt;/i&gt;');
  });

  it('keeps the number as the Bangla digits it was given', () => {
    expect(build(SAMPLE_STAT.bn, 'portrait', 'bn').html).toContain('>৬৮%</p>');
  });
});

describe('the question layout', () => {
  it.each(STACKED)('%s: stacks the kicker, the question and the options', (size) => {
    const { html } = build(SAMPLE_QUESTION.en, size);
    expect(textAreaBlocks(html)).toEqual(['kicker', 'question', 'options']);
  });

  it('landscape: kicker and question are the left column, the options the right', () => {
    const { html } = build(SAMPLE_QUESTION.en, 'landscape');
    expect(textAreaBlocks(html)).toEqual([
      'col col-text',
      'kicker',
      'question',
      'col col-detail',
      'options',
    ]);
  });

  it.each(['en', 'bn'] as const)('%s: gives each text option a letter of its language', (lang) => {
    const { html } = build(SAMPLE_QUESTION[lang], 'portrait', lang);
    const marks = [...html.matchAll(/<span class="option-mark">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(marks).toEqual(lang === 'en' ? ['A', 'B', 'C'] : ['ক', 'খ', 'গ', 'ঘ']);
  });

  it('draws the options as a list, not as buttons: no link, button or form', () => {
    const { html } = build(SAMPLE_QUESTION.en, 'portrait');
    expect(html).toMatch(/<ul class="options">(<li class="option">.*<\/li>)+<\/ul>/);
    expect(html).not.toMatch(/<(a|button|input|form)\b/);
  });

  it('reads an option as text, with its highlight in a mark', () => {
    const slide: Slide = {
      ...SAMPLE_QUESTION.en,
      options: [{ text: 'Go <now>' }, { text: 'Stay *put*' }],
    };
    const { html } = build(slide, 'portrait');
    expect(html).toContain('Go &lt;now&gt;');
    expect(html).toContain('<mark class="hl">put</mark>');
  });

  describe('with pictures as options', () => {
    it.each(STACKED)('%s: stacks the kicker, the question and one box of pictures', (size) => {
      const { html } = build(SAMPLE_QUESTION_IMAGES.en, size);
      expect(textAreaBlocks(html)).toEqual(['kicker', 'question', 'image-box option-images']);
      expect(has(html, 'options')).toBe(false);
    });

    it('landscape: the pictures are the right column', () => {
      const { html } = build(SAMPLE_QUESTION_IMAGES.en, 'landscape');
      expect(textAreaBlocks(html)).toEqual([
        'col col-text',
        'kicker',
        'question',
        'image-box option-images',
      ]);
    });

    it('draws each picture through the job assets with its letter on a tile', () => {
      const { html } = build(SAMPLE_QUESTION_IMAGES.bn, 'portrait', 'bn');
      expect(html.match(/<li class="option-image">/g)).toHaveLength(4);
      expect(html).toContain('lzp-asset:image/photo_sample_1');
      expect(html).toContain('lzp-asset:image/mascot_1');
      const marks = [...html.matchAll(/<span class="option-mark">([^<]+)<\/span>/g)].map(
        (m) => m[1],
      );
      expect(marks).toEqual(['ক', 'খ', 'গ', 'ঘ']);
    });

    it('warns, and draws no tile for that option, for an image that is not an asset', () => {
      const slide: Slide = {
        ...SAMPLE_QUESTION_IMAGES.en,
        options: [
          { image: { asset: 'https://example.com/a.jpg' } },
          { image: { asset: 'photo_sample_1' } },
        ],
      };
      const { html, warnings } = build(slide, 'portrait');
      expect(html.match(/<li class="option-image">/g)).toHaveLength(1);
      expect(warnings).toMatchObject([
        { code: 'image-not-an-asset', field: 'slides[0].options[0].image.asset' },
      ]);
    });
  });

  describe('with a mix of text and pictures', () => {
    const mixed: Slide = {
      ...SAMPLE_QUESTION.en,
      options: [{ text: 'The tall one' }, { image: { asset: 'photo_sample_1' } }],
    };

    it('lists them in order, a picture as a thumbnail beside its letter', () => {
      const { html } = build(mixed, 'portrait');
      expect(textAreaBlocks(html)).toEqual(['kicker', 'question', 'options']);
      expect(html).toMatch(
        /<li class="option"><span class="option-mark">A<\/span><span class="option-text">The tall one<\/span><\/li><li class="option"><span class="option-mark">B<\/span><img [^>]*class="option-thumb"/,
      );
    });
  });
});

describe('the offer layout', () => {
  it.each(STACKED)('%s: stacks badge, title, image, price, details and call to action', (size) => {
    const { html } = build(SAMPLE_OFFER.en, size);
    expect(textAreaBlocks(html)).toEqual([
      'badge small-print',
      'title',
      'image-box',
      'price',
      'details',
      'cta-line',
    ]);
  });

  it('landscape: the text is the left column and the image the right', () => {
    const { html } = build(SAMPLE_OFFER.en, 'landscape');
    expect(textAreaBlocks(html)).toEqual([
      'col col-text',
      'badge small-print',
      'title',
      'price',
      'details',
      'cta-line',
      'image-box',
    ]);
    expect(html.indexOf('class="col col-text"')).toBeLessThan(html.indexOf('class="image-box"'));
  });

  it.each(SIZE_NAMES)('%s: leaves no hole when the image and the price are missing', (size) => {
    const { html } = build(bareOffer('en'), size);
    for (const gone of ['image-box', 'photo', 'price']) expect(has(html, gone)).toBe(false);
    for (const there of ['badge', 'title', 'details', 'cta-line'])
      expect(has(html, there)).toBe(true);
  });

  it('draws the image through the job assets, and warns for one that is not an asset', () => {
    expect(build(SAMPLE_OFFER.en, 'portrait').html).toContain('lzp-asset:image/photo_sample_1');
    const slide = { ...SAMPLE_OFFER.en, image: { asset: 'https://example.com/a.jpg' } };
    const { html, warnings } = build(slide, 'portrait');
    expect(has(html, 'image-box')).toBe(false);
    expect(warnings).toMatchObject([
      { code: 'image-not-an-asset', field: 'slides[0].image.asset' },
    ]);
  });

  it('puts the call to action in a highlight and the title highlight in a mark, as text', () => {
    const slide = { ...SAMPLE_OFFER.en, cta: 'Go <now>' };
    const { html } = build(slide, 'portrait');
    expect(html).toContain('<p class="cta-line"><mark class="hl">Go &lt;now&gt;</mark></p>');
    expect(/<h1 class="title">[^]*<mark class="hl">posture<\/mark>[^]*<\/h1>/.test(html)).toBe(
      true,
    );
  });

  it('reads the badge, the price and the details as plain text', () => {
    const slide = { ...SAMPLE_OFFER.en, badge: '<u>New</u>', price: '$<b>9</b>', details: 'a & b' };
    const { html } = build(slide, 'portrait');
    expect(html).toContain('<p class="badge small-print">&lt;u&gt;New&lt;/u&gt;</p>');
    expect(html).toContain('<p class="price">$&lt;b&gt;9&lt;/b&gt;</p>');
    expect(html).toContain('<p class="details">a &amp; b</p>');
  });
});

describe('the logo switch', () => {
  it('still draws the corner logo, at the top for a pin', () => {
    for (const [, samples] of LAYOUTS) {
      expect(build(samples.en, 'pin').html).toContain('<header class="header">');
      expect(build(samples.en, 'portrait').html).toContain('<footer class="footer">');
    }
  });
});

describe('the contrast pairs they register (§07 Contrast)', () => {
  it('registers stat, question and offer', () => {
    expect(registeredLayouts()).toEqual(expect.arrayContaining(['stat', 'question', 'offer']));
  });

  describe.each(LAYOUTS)('%s', (layout) => {
    it.each(SIZE_NAMES)('%s: every pair passes with the Clean look sample kit', (size) => {
      const results = checkPairs(KIT, 'clean', pairsFor(layout, KIT, 'clean', size));
      expect(results.length).toBeGreaterThan(0);
      expect(results.filter((result) => !result.passes)).toEqual([]);
    });

    it.each(SIZE_NAMES)('%s: small print is a fixed 28 px and body is at its floor', (size) => {
      const pairs = pairsFor(layout, KIT, 'clean', size);
      for (const pair of pairs.filter((candidate) => candidate.name.includes('small print')))
        expect(pair.px).toBe(SMALL_PRINT_PX);
      for (const pair of pairs.filter((candidate) =>
        /: (body|label|details)$/.test(candidate.name),
      ))
        expect(pair.px).toBeGreaterThanOrEqual(SIZES[size].bodyFloor);
      for (const pair of pairs) expect(pair.width).toBe(SIZES[size].width);
    });
  });

  it('judges the stat number as the headline, at its real, smallest size', () => {
    const portrait = pairsFor('stat', KIT, 'clean', 'portrait');
    const number = portrait.find((pair) => pair.name === 'stat: number');
    expect(number?.headline).toBe(true);
    expect(number?.px).toBeCloseTo(96 * 2 * K_MIN);
    expect(portrait.some((pair) => pair.name === 'stat: small print')).toBe(true);
  });

  it('declares the question as the headline, and the offer title and price too', () => {
    const question = pairsFor('question', KIT, 'clean', 'portrait');
    expect(question.filter((pair) => pair.headline === true).map((pair) => pair.name)).toContain(
      'question: question',
    );
    const offer = pairsFor('offer', KIT, 'clean', 'portrait');
    expect(offer.filter((pair) => pair.headline === true).map((pair) => pair.name)).toEqual(
      expect.arrayContaining(['offer: title', 'offer: price']),
    );
    expect(offer.map((pair) => pair.name)).toEqual(
      expect.arrayContaining(['offer: badge', 'offer: details', 'offer: call to action']),
    );
  });

  it('declares the option letters and text of a question, and the letters on its pictures, on a photo', () => {
    const pairs = pairsFor('question', KIT, 'clean', 'portrait');
    expect(pairs.map((pair) => pair.name)).toEqual(
      expect.arrayContaining(['question: option letter', 'question: option']),
    );
    const onPhoto = pairs.filter((pair) => typeof pair.on === 'object' && 'photo' in pair.on);
    expect(onPhoto.map((pair) => pair.name)).toEqual(['question: letter on picture']);
    expect(onPhoto[0]?.px).toBe(SMALL_PRINT_PX);
  });

  it('declares no photo pair for stat and offer: they draw no text over a photo', () => {
    for (const layout of ['stat', 'offer'] as const)
      for (const size of SIZE_NAMES)
        for (const pair of pairsFor(layout, KIT, 'clean', size))
          expect(pair.on).not.toEqual({ photo: true });
  });
});

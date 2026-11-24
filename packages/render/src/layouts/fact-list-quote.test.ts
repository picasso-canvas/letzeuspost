import { SIZE_NAMES, SlideSchema, type Slide } from '@lzp/core';
import { describe, expect, it } from 'vitest';
import { checkPairs, pairsFor, registeredLayouts } from '../contrast/pairs.ts';
import { K_MIN } from '../fit/report.ts';
import { SIZES, SMALL_PRINT_PX } from '../sizes.ts';
import {
  LONG_BODY,
  LONGEST_LIST_ITEMS,
  SAMPLE_FACT,
  SAMPLE_LIST,
  SAMPLE_PUBLIC_QUOTE,
  SAMPLE_QUOTE,
} from './samples.ts';
import { build, has, KIT, textAreaBlocks } from './test-helpers.ts';

// The fact, list and quote layouts (§07 Layouts, §08 Sizes and arrangements). These read the HTML `buildSlide` makes;
// the browser specs in `tests/render/` draw it and run the fit check.

const STACKED = SIZE_NAMES.filter((size) => SIZES[size].arrangement === 'stacked');
const LAYOUTS = [
  ['fact', SAMPLE_FACT],
  ['list', SAMPLE_LIST],
  ['quote', SAMPLE_QUOTE],
] as const;

describe('the samples are valid slides', () => {
  it.each(['en', 'bn'] as const)('%s: each passes its own schema', (lang) => {
    for (const slide of [
      SAMPLE_FACT[lang],
      SAMPLE_LIST[lang],
      SAMPLE_QUOTE[lang],
      SAMPLE_PUBLIC_QUOTE[lang],
    ])
      expect(SlideSchema.safeParse(slide).success).toBe(true);
  });

  it.each(['en', 'bn'] as const)(
    '%s: the longest list is five items of the 8 words §07 allows',
    (lang) => {
      const items = LONGEST_LIST_ITEMS[lang];
      expect(items).toHaveLength(5);
      const slide = { ...SAMPLE_LIST[lang], items };
      expect(SlideSchema.safeParse(slide).success).toBe(true);
      const ninth = items.map((item, at) => (at === 0 ? `${item} more` : item));
      expect(SlideSchema.safeParse({ ...slide, items: ninth }).success).toBe(false);
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

  it('is stacked in every size but landscape, and in columns there', () => {
    for (const size of SIZE_NAMES) {
      const { html } = build(samples.en, size);
      expect(has(html, 'col-text')).toBe(SIZES[size].arrangement === 'columns');
    }
  });

  it.each(['en', 'bn'] as const)('%s: draws every size in the language of the post', (lang) => {
    for (const size of SIZE_NAMES) expect(build(samples[lang], size, lang).warnings).toEqual([]);
  });

  it('still draws the corner logo and the page number frame', () => {
    expect(build(samples.en, 'portrait').html).toContain('<footer class="footer">');
    expect(build(samples.en, 'pin').html).toContain('<header class="header">');
  });
});

describe('the fact layout', () => {
  const fact = SAMPLE_FACT.en;
  const bare = { ...fact } as Partial<typeof fact>;
  delete bare.image;

  it.each(STACKED)('%s: stacks kicker, title, image, body and source', (size) => {
    const { html } = build(fact, size);
    expect(textAreaBlocks(html)).toEqual([
      'kicker',
      'title',
      'image-box',
      'body',
      'source small-print',
    ]);
  });

  it('landscape: text is the left column and the image box the right', () => {
    const { html } = build(fact, 'landscape');
    expect(textAreaBlocks(html)).toEqual([
      'col col-text',
      'kicker',
      'title',
      'body',
      'source small-print',
      'image-box',
    ]);
    expect(html.indexOf('class="col col-text"')).toBeLessThan(html.indexOf('class="image-box"'));
  });

  it.each(SIZE_NAMES)('%s: leaves no hole when the image is missing', (size) => {
    const { html, warnings } = build(bare as Slide, size);
    expect(has(html, 'image-box')).toBe(false);
    expect(html).not.toContain('<img class="photo"');
    expect(html).not.toContain('class="photo"');
    for (const name of ['kicker', 'title', 'body', 'source']) expect(has(html, name)).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('landscape without an image keeps one column, so the text has the whole width', () => {
    const { html } = build(bare as Slide, 'landscape');
    expect(html.match(/class="col /g)).toHaveLength(1);
  });

  it('labels the source in the language of the post, as small print', () => {
    expect(build(fact, 'portrait').html).toContain(
      '<p class="source small-print">Source: Stillwater Physio guide, 2026</p>',
    );
    expect(build(SAMPLE_FACT.bn, 'portrait', 'bn').html).toContain(
      '<p class="source small-print">সূত্র: মেঘলা কাফের রান্নাঘরের খাতা, ২০২৬</p>',
    );
  });

  it('escapes the source: nothing a post says is ever HTML', () => {
    const { html } = build({ ...fact, source: 'Doc <b>1</b> & "co"' }, 'portrait');
    expect(html).toContain('Source: Doc &lt;b&gt;1&lt;/b&gt; &amp; &quot;co&quot;');
  });

  it('warns, and draws no image, for an image that is not an asset', () => {
    const { html, warnings } = build(
      { ...fact, image: { asset: 'https://example.com/a.jpg' } },
      'square',
    );
    expect(has(html, 'image-box')).toBe(false);
    expect(warnings).toMatchObject([
      { code: 'image-not-an-asset', field: 'slides[0].image.asset' },
    ]);
  });

  it.each(['en', 'bn'] as const)('%s: puts the highlight in a mark, in the title', (lang) => {
    const { html } = build(SAMPLE_FACT[lang], 'portrait', lang);
    expect(/<h1 class="title">[^]*<mark class="hl">[^<]+<\/mark>[^]*<\/h1>/.test(html)).toBe(true);
  });
});

describe('the list layout', () => {
  const list = SAMPLE_LIST.en;
  const item = (html: string) =>
    [...html.matchAll(/<li class="item">([^]*?)<\/li>/g)].map((m) => m[1]);

  it.each(STACKED)('%s: the title, then the items', (size) => {
    expect(textAreaBlocks(build(list, size).html)).toEqual(['title', 'items']);
  });

  it('landscape: the title is the left column and the items the right (a list has no image)', () => {
    const { html } = build(list, 'landscape');
    expect(textAreaBlocks(html)).toEqual(['col col-text', 'title', 'col col-detail', 'items']);
    expect(has(html, 'image-box')).toBe(false);
    expect(html.indexOf('class="title"')).toBeLessThan(html.indexOf('class="items"'));
  });

  it.each(['en', 'bn'] as const)('%s: draws each item once, in order, as a list item', (lang) => {
    const { html } = build(SAMPLE_LIST[lang], 'portrait', lang);
    expect(item(html)).toEqual(SAMPLE_LIST[lang].items);
    expect(html).toContain('<ul class="items">');
  });

  it('draws five items, the most allowed', () => {
    const five = { ...list, items: LONGEST_LIST_ITEMS.en };
    expect(item(build(five, 'square').html)).toHaveLength(5);
  });

  it('escapes every item, and reads a highlight in one', () => {
    const { html } = build(
      { ...list, items: ['a <i>b</i>', 'say *this* now', 'c & d'] },
      'portrait',
    );
    expect(item(html)).toEqual([
      'a &lt;i&gt;b&lt;/i&gt;',
      'say <mark class="hl">this</mark> now',
      'c &amp; d',
    ]);
  });

  it('has no kicker, body, image or source to leave a hole', () => {
    const { html } = build(list, 'portrait');
    for (const name of ['kicker', 'body', 'image-box', 'source'])
      expect(has(html, name)).toBe(false);
  });
});

describe('the quote layout', () => {
  const quote = SAMPLE_QUOTE.en;

  it.each(STACKED)("%s: stacks the quote, the person and the person's role", (size) => {
    expect(textAreaBlocks(build(quote, size).html)).toEqual([
      'quote',
      'person',
      'role small-print',
    ]);
  });

  it('landscape: one column with everything, since a quote has no image to put on the right', () => {
    const { html } = build(quote, 'landscape');
    expect(textAreaBlocks(html)).toEqual(['col col-text', 'quote', 'person', 'role small-print']);
    expect(has(html, 'image-box')).toBe(false);
  });

  it('puts the words in quotation marks, in both languages', () => {
    expect(build(quote, 'portrait').html).toContain(`<p class="quote">“${quote.quote}”</p>`);
    expect(build(SAMPLE_QUOTE.bn, 'portrait', 'bn').html).toContain(
      `<p class="quote">“${SAMPLE_QUOTE.bn.quote}”</p>`,
    );
  });

  it('shows no source for the brand’s own people', () => {
    expect(has(build(quote, 'portrait').html, 'source')).toBe(false);
  });

  it.each(['en', 'bn'] as const)(
    '%s: a public quote shows its source, labelled, as small print',
    (lang) => {
      const slide = SAMPLE_PUBLIC_QUOTE[lang];
      const { html } = build(slide, 'portrait', lang);
      const label = lang === 'en' ? 'Source:' : 'সূত্র:';
      expect(html).toContain(`<p class="source small-print">${label} ${slide.source ?? ''}</p>`);
      expect(textAreaBlocks(html)).toEqual([
        'quote',
        'person',
        'role small-print',
        'source small-print',
      ]);
    },
  );

  it('escapes the quote, the person and the role', () => {
    const { html } = build(
      { ...quote, quote: 'Hi <img src=x onerror=1>', person: 'A & B', role: '<b>CEO</b>' },
      'portrait',
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('“Hi &lt;img src=x onerror=1&gt;”');
    expect(html).toContain('A &amp; B');
    expect(html).toContain('&lt;b&gt;CEO&lt;/b&gt;');
  });

  it('has no title, kicker, body or image to leave a hole', () => {
    const { html } = build(quote, 'portrait');
    for (const name of ['title', 'kicker', 'body', 'image-box'])
      expect(has(html, name)).toBe(false);
  });
});

describe('long text is drawn whole', () => {
  it('keeps the whole of the longest text in every field, never cut by the builder', () => {
    const fact = { ...SAMPLE_FACT.en, body: LONG_BODY.en };
    expect(build(fact, 'story').html).toContain(LONG_BODY.en);
    const list = { ...SAMPLE_LIST.en, items: LONGEST_LIST_ITEMS.en };
    for (const text of LONGEST_LIST_ITEMS.en) expect(build(list, 'pin').html).toContain(text);
    const quote = { ...SAMPLE_QUOTE.en, quote: LONG_BODY.en };
    expect(build(quote, 'landscape').html).toContain(LONG_BODY.en);
  });
});

describe('the contrast pairs they register (§07 Contrast)', () => {
  it('registers fact, list and quote', () => {
    expect(registeredLayouts()).toEqual(expect.arrayContaining(['fact', 'list', 'quote']));
  });

  describe.each(LAYOUTS)('%s', (layout) => {
    it.each(SIZE_NAMES)('%s: every pair passes with the Clean look sample kit', (size) => {
      const results = checkPairs(KIT, 'clean', pairsFor(layout, KIT, 'clean', size));
      expect(results.length).toBeGreaterThan(0);
      expect(results.filter((result) => !result.passes)).toEqual([]);
    });

    it.each(SIZE_NAMES)(
      '%s: judges every pair at the width of its size, small print at 28 px',
      (size) => {
        for (const pair of pairsFor(layout, KIT, 'clean', size)) {
          expect(pair.width).toBe(SIZES[size].width);
          if (pair.name.includes('small print')) expect(pair.px).toBe(SMALL_PRINT_PX);
        }
      },
    );

    it('declares no photo pair: none of the three draws text over a photo', () => {
      for (const size of SIZE_NAMES)
        for (const pair of pairsFor(layout, KIT, 'clean', size))
          expect(pair.on).not.toEqual({ photo: true });
    });
  });

  const names = (layout: 'fact' | 'list' | 'quote') =>
    pairsFor(layout, KIT, 'clean', 'portrait').map((pair) => pair.name);

  it('fact: title, kicker, body and the source as small print', () => {
    expect(names('fact')).toEqual(
      expect.arrayContaining(['fact: title', 'fact: kicker', 'fact: body', 'fact: small print']),
    );
  });

  it('list: title and items (at body size), no small print', () => {
    expect(names('list')).toEqual(expect.arrayContaining(['list: title', 'list: body']));
    expect(names('list').filter((name) => name.includes('small print'))).toEqual([]);
  });

  it.each(SIZE_NAMES)(
    '%s: quote, person, role and source: the quote is the headline, at its real size',
    (size) => {
      const pairs = pairsFor('quote', KIT, 'clean', size);
      expect(pairs.map((pair) => pair.name)).toEqual(
        expect.arrayContaining(['quote: quote', 'quote: person', 'quote: small print']),
      );
      expect(pairs.filter((pair) => pair.headline === true).map((pair) => pair.name)).toContain(
        'quote: quote',
      );
      const px = pairs.find((pair) => pair.name === 'quote: quote')?.px ?? 0;
      expect(px).toBeGreaterThan(SIZES[size].bodyFloor);
      expect(pairs.find((pair) => pair.name === 'quote: person')?.px).toBeGreaterThanOrEqual(
        SIZES[size].bodyFloor,
      );
    },
  );

  it('judges the quote at the smallest size the fit check can set it: 0.9 of the title, at K_MIN', () => {
    const px = (size: 'portrait' | 'landscape') =>
      pairsFor('quote', KIT, 'clean', size).find((pair) => pair.name === 'quote: quote')?.px;
    expect(px('portrait')).toBeCloseTo(96 * 0.9 * K_MIN);
    expect(px('landscape')).toBeCloseTo(60 * 0.9 * K_MIN);
  });
});

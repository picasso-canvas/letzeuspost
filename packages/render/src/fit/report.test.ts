import type { Slide } from '@lzp/core';
import { describe, expect, it } from 'vitest';
import { testBanglaPost, testPost, testSlide } from '../page/test-fixtures.ts';
import { buildFitReport, FitReportSchema, PageFitSchema, type PageFit } from './report.ts';

// §08's fit report: { size, slide, k, status, fields: [{ field, lines, graphemes, overflowPx, targetGraphemes }] }.
const EXAMPLE = {
  size: 'landscape',
  slide: 1,
  k: 0.85,
  status: 'fail',
  fields: [
    { field: 'slides[0].title', lines: 4, graphemes: 52, overflowPx: 88, targetGraphemes: 38 },
  ],
};

describe('FitReportSchema', () => {
  it("accepts §08's example", () => {
    expect(FitReportSchema.parse(EXAMPLE)).toEqual(EXAMPLE);
  });

  it('accepts a pass with no fields, at 1 or any k down to 0.85', () => {
    for (const k of [1, 0.9, 0.85])
      expect(
        FitReportSchema.safeParse({ size: 'square', slide: 2, k, status: 'pass', fields: [] })
          .success,
      ).toBe(true);
  });

  it.each([
    ['a k under 0.85', { ...EXAMPLE, k: 0.84 }],
    ['a k over 1', { ...EXAMPLE, k: 1.01 }],
    ['an unknown size', { ...EXAMPLE, size: 'banner' }],
    ['a slide number of 0 (slides count from 1)', { ...EXAMPLE, slide: 0 }],
    ['a status that is neither pass nor fail', { ...EXAMPLE, status: 'warn' }],
    [
      'a field that is not a path into the post',
      { ...EXAMPLE, fields: [{ ...field(), field: 'title' }] },
    ],
    ['a half line', { ...EXAMPLE, fields: [{ ...field(), lines: 1.5 }] }],
    ['a negative overflow', { ...EXAMPLE, fields: [{ ...field(), overflowPx: -1 }] }],
    ['a target of 0', { ...EXAMPLE, fields: [{ ...field(), targetGraphemes: 0 }] }],
    ['a key the schema doesn’t know', { ...EXAMPLE, extra: true }],
  ])('refuses %s', (_name, report) => {
    expect(FitReportSchema.safeParse(report).success).toBe(false);
  });
});

function field() {
  return {
    field: 'slides[0].title',
    lines: 4,
    graphemes: 52,
    overflowPx: 88,
    targetGraphemes: 38,
  };
}

describe('PageFitSchema', () => {
  it('refuses what the page could not have measured', () => {
    expect(PageFitSchema.safeParse({ k: 0.8, fits: true, fields: [] }).success).toBe(false);
    expect(PageFitSchema.safeParse({ k: 1, fits: 'yes', fields: [] }).success).toBe(false);
    expect(PageFitSchema.safeParse({ k: 1, fits: true }).success).toBe(false);
    expect(PageFitSchema.safeParse(undefined).success).toBe(false);
  });
});

const page = (overrides: Partial<PageFit> = {}): PageFit => ({
  k: 0.85,
  fits: false,
  fields: [{ name: 'title', lines: 4, needed: 400, available: 300, overflowPx: 100 }],
  ...overrides,
});

describe('buildFitReport', () => {
  it('reports a slide that fits at 1.00 as k 1 and pass, with no fields', () => {
    const post = testPost();
    const report = buildFitReport(post, 0, 'portrait', { k: 1, fits: true, fields: [] });
    expect(report).toEqual({ size: 'portrait', slide: 1, k: 1, status: 'pass', fields: [] });
  });

  it('reports the scale a slide needed when it fits below 1.00', () => {
    const report = buildFitReport(testPost(), 0, 'square', { k: 0.9, fits: true, fields: [] });
    expect(report).toMatchObject({ k: 0.9, status: 'pass' });
  });

  it('names a field by its path with lines, graphemes, overflow and a target length', () => {
    const slide = testSlide({ title: 'ab'.repeat(26) }); // 52 graphemes
    const report = buildFitReport(testPost(slide), 0, 'landscape', page());
    expect(report).toEqual({
      size: 'landscape',
      slide: 1,
      k: 0.85,
      status: 'fail',
      // 52 × (300 ÷ 400) × 0.95 = 37.05
      fields: [
        { field: 'slides[0].title', lines: 4, graphemes: 52, overflowPx: 100, targetGraphemes: 37 },
      ],
    });
    expect(FitReportSchema.safeParse(report).success).toBe(true);
  });

  it('counts the second slide as slide 2 and its path as slides[1]', () => {
    const post = testPost(testSlide(), {
      slides: [testSlide(), testSlide({ body: 'x'.repeat(100) })],
    });
    const report = buildFitReport(post, 1, 'story', {
      k: 0.85,
      fits: false,
      fields: [{ name: 'body', lines: 9, needed: 500, available: 250, overflowPx: 250 }],
    });
    expect(report.slide).toBe(2);
    expect(report.fields).toEqual([
      { field: 'slides[1].body', lines: 9, graphemes: 100, overflowPx: 250, targetGraphemes: 47 },
    ]);
  });

  it('counts what is drawn: the highlight marks are not graphemes', () => {
    const slide = testSlide({ title: 'Pitha is *older* than tea' });
    const [field] = buildFitReport(testPost(slide), 0, 'portrait', page()).fields;
    expect(field?.graphemes).toBe('Pitha is older than tea'.length);
  });

  it('counts a Bangla conjunct as one grapheme', () => {
    // য + ় stay together and ক্ষ is one: ‘ক্ষত’ is 2 graphemes in 4 code points
    const post = testBanglaPost();
    const slide = post.slides[0];
    if (slide?.layout !== 'text') throw new Error('no text slide');
    const bangla = { ...post, slides: [{ ...slide, title: 'ক্ষত ক্ষমা' }] };
    const [field] = buildFitReport(bangla, 0, 'portrait', page()).fields;
    expect(field?.graphemes).toBe(5); // ক্ষ ত ␠ ক্ষ মা → ক্ষ, ত, space, ক্ষ, মা
  });

  it('never gives a target under 1 and rounds a target down', () => {
    const report = buildFitReport(testPost(testSlide({ title: 'abc' })), 0, 'portrait', {
      k: 0.85,
      fits: false,
      fields: [{ name: 'title', lines: 2, needed: 100, available: 0, overflowPx: 100 }],
    });
    expect(report.fields[0]?.targetGraphemes).toBe(1);
  });

  it("names a list slide's items by one field, counting every item's drawn graphemes", () => {
    const slide: Slide = {
      layout: 'list',
      title: 'Desk habits',
      items: ['Stand up *every* hour', 'Drink water', 'ক্ষত ক্ষমা'],
      alt: 'A desk',
    };
    const report = buildFitReport({ ...testPost(), slides: [slide] }, 0, 'portrait', {
      k: 0.85,
      fits: false,
      fields: [{ name: 'items', lines: 6, needed: 600, available: 300, overflowPx: 300 }],
    });
    // 'Stand up every hour' 19 + 'Drink water' 11 + 'ক্ষত ক্ষমা' 5 = 35; 35 × 0.5 × 0.95 = 16.6
    expect(report.fields).toEqual([
      { field: 'slides[0].items', lines: 6, graphemes: 35, overflowPx: 300, targetGraphemes: 16 },
    ]);
    expect(FitReportSchema.safeParse(report).success).toBe(true);
  });

  it("names a question slide's options by one field, counting the text options only", () => {
    const slide: Slide = {
      layout: 'question',
      kicker: 'Your turn',
      question: 'Which one?',
      options: [
        { text: 'The *tall* one' },
        { image: { asset: 'photo_1' } },
        { text: 'ক্ষত ক্ষমা' },
      ],
      alt: 'A question',
    };
    const report = buildFitReport({ ...testPost(), slides: [slide] }, 0, 'portrait', {
      k: 0.85,
      fits: false,
      fields: [{ name: 'options', lines: 4, needed: 400, available: 200, overflowPx: 200 }],
    });
    // 'The tall one' 12 + 'ক্ষত ক্ষমা' 5 = 17; 17 × 0.5 × 0.95 = 8.07
    expect(report.fields).toEqual([
      { field: 'slides[0].options', lines: 4, graphemes: 17, overflowPx: 200, targetGraphemes: 8 },
    ]);
    expect(FitReportSchema.safeParse(report).success).toBe(true);
  });

  it('refuses options that are all pictures: there is no text to shorten', () => {
    const slide: Slide = {
      layout: 'question',
      kicker: 'Your turn',
      question: 'Which one?',
      options: [{ image: { asset: 'photo_1' } }, { image: { asset: 'photo_2' } }],
      alt: 'A question',
    };
    expect(() =>
      buildFitReport({ ...testPost(), slides: [slide] }, 0, 'portrait', {
        k: 0.85,
        fits: false,
        fields: [{ name: 'options', lines: 4, needed: 400, available: 200, overflowPx: 200 }],
      }),
    ).toThrow(/options/);
  });

  it('refuses a field whose value is neither a text nor a list of texts', () => {
    const slide = { ...testSlide(), title: 5 };
    // a slide the schema would have refused: the report still must not report a count for it
    const post = { ...testPost(), slides: [slide as unknown as Slide] };
    expect(() => buildFitReport(post, 0, 'portrait', page())).toThrow(/title/);
  });

  it('refuses a slide that is not in the post, and a field the slide has no text for', () => {
    expect(() => buildFitReport(testPost(), 3, 'portrait', page())).toThrow(/slide/);
    expect(() =>
      buildFitReport(testPost(), 0, 'portrait', {
        k: 0.85,
        fits: false,
        fields: [{ name: 'nothing', lines: 1, needed: 10, available: 5, overflowPx: 5 }],
      }),
    ).toThrow(/nothing/);
  });
});

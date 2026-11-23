import { describe, expect, it } from 'vitest';
import { image, slides } from './test-fixtures.ts';
import { LAYOUT_NAMES, SlideSchema, slideSchemas } from './slide.ts';

const ok = (slide: unknown) => SlideSchema.safeParse(slide).success;
const withFields = (layout: keyof typeof slides, fields: Record<string, unknown>) => ({
  ...slides[layout],
  ...fields,
});
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${String(i)}`).join(' ');

describe('the 14 layouts of §07', () => {
  it('are cover, fact, step, list, quote, stat, question, offer, cta, text, testimonial, photocard, meme, beforeafter', () => {
    expect([...LAYOUT_NAMES]).toEqual([
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
    ]);
  });

  it('each have a slide schema of their own', () => {
    expect(Object.keys(slideSchemas).sort()).toEqual([...LAYOUT_NAMES].sort());
  });
});

describe.each(LAYOUT_NAMES)('the %s slide', (layout) => {
  const sample = slides[layout];

  it('accepts its sample content, through its own schema and through SlideSchema', () => {
    expect(slideSchemas[layout]?.safeParse(sample).success).toBe(true);
    expect(ok(sample)).toBe(true);
  });

  it('rejects a missing, empty or blank alt', () => {
    const { alt: _alt, ...noAlt } = sample;
    expect(ok(noAlt)).toBe(false);
    expect(ok({ ...sample, alt: '' })).toBe(false);
    expect(ok({ ...sample, alt: '   ' })).toBe(false);
  });

  it('rejects an unknown key', () => {
    expect(ok({ ...sample, colour: 'red' })).toBe(false);
  });

  it("rejects another layout's name on its fields", () => {
    expect(ok({ ...sample, layout: 'nonsense' })).toBe(false);
  });
});

describe('required fields', () => {
  it.each([
    ['cover', 'kicker'],
    ['cover', 'title'],
    ['fact', 'body'],
    ['fact', 'source'],
    ['step', 'image'],
    ['step', 'title'],
    ['list', 'items'],
    ['quote', 'person'],
    ['stat', 'number'],
    ['stat', 'source'],
    ['question', 'options'],
    ['offer', 'cta'],
    ['cta', 'body'],
    ['photocard', 'source'],
    ['photocard', 'photoCredit'],
    ['testimonial', 'customer'],
    ['beforeafter', 'after'],
  ] as const)('%s needs %s', (layout, field) => {
    const { [field]: _gone, ...rest } = slides[layout];
    expect(ok(rest)).toBe(false);
    expect(ok({ ...slides[layout], [field]: '' })).toBe(false);
  });

  it('accepts the optional fields: cover body, image and sticker; text source; offer image', () => {
    expect(ok(withFields('cover', { body: 'More', image, sticker: 'New!' }))).toBe(true);
    expect(ok(withFields('text', { source: 'Our menu' }))).toBe(true);
    expect(ok(withFields('offer', { image }))).toBe(true);
    expect(ok(withFields('testimonial', { photo: image }))).toBe(true);
  });
});

describe('cover: the title has at most 8 words', () => {
  it('accepts 8 words', () => {
    expect(ok(withFields('cover', { title: words(8) }))).toBe(true);
  });

  it('rejects 9 words', () => {
    expect(ok(withFields('cover', { title: words(9) }))).toBe(false);
  });

  it('does not count the * of a highlight, and counts Bangla words', () => {
    expect(ok(withFields('cover', { title: `${words(6)} *w6 w7*` }))).toBe(true);
    expect(ok(withFields('cover', { title: 'এক দুই তিন চার পাঁচ ছয় সাত আট নয়' }))).toBe(false);
    expect(ok(withFields('cover', { title: 'এক দুই তিন চার পাঁচ ছয় সাত *আট*' }))).toBe(true);
  });
});

describe('fact and stat need a source', () => {
  it.each(['fact', 'stat'] as const)('%s rejects a blank source', (layout) => {
    expect(ok(withFields(layout, { source: '  ' }))).toBe(false);
  });
});

describe('list: 3–5 items of at most 8 words', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => `Tip ${String(i)}`);

  it.each([3, 4, 5])('accepts %i items', (n) => {
    expect(ok(withFields('list', { items: items(n) }))).toBe(true);
  });

  it.each([0, 1, 2, 6])('rejects %i items', (n) => {
    expect(ok(withFields('list', { items: items(n) }))).toBe(false);
  });

  it('accepts an item of 8 words and rejects one of 9', () => {
    expect(ok(withFields('list', { items: [words(8), 'b', 'c'] }))).toBe(true);
    expect(ok(withFields('list', { items: [words(9), 'b', 'c'] }))).toBe(false);
  });

  it('rejects a blank item', () => {
    expect(ok(withFields('list', { items: ['a', ' ', 'c'] }))).toBe(false);
  });
});

describe('question: 2–4 options, text or image', () => {
  const options = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ text: `Option ${String(i)}` }));

  it.each([2, 3, 4])('accepts %i options', (n) => {
    expect(ok(withFields('question', { options: options(n) }))).toBe(true);
  });

  it.each([0, 1, 5])('rejects %i options', (n) => {
    expect(ok(withFields('question', { options: options(n) }))).toBe(false);
  });

  it('accepts image options, alone or mixed with text ones', () => {
    expect(ok(withFields('question', { options: [{ image }, { image }] }))).toBe(true);
    expect(ok(withFields('question', { options: [{ text: 'A' }, { image }] }))).toBe(true);
  });

  it('rejects an option with neither text nor image, an empty text, or an unknown key', () => {
    expect(ok(withFields('question', { options: [{}, { text: 'A' }] }))).toBe(false);
    expect(ok(withFields('question', { options: [{ text: '' }, { text: 'A' }] }))).toBe(false);
    expect(ok(withFields('question', { options: [{ text: 'A', votes: 2 }, { text: 'B' }] }))).toBe(
      false,
    );
  });
});

describe('quote: a public quote needs a source', () => {
  it('rejects a public quote without a source, or with a blank one', () => {
    expect(ok(withFields('quote', { public: true }))).toBe(false);
    expect(ok(withFields('quote', { public: true, source: ' ' }))).toBe(false);
  });

  it('accepts a public quote with a source', () => {
    expect(ok(withFields('quote', { public: true, source: 'The Daily Star, 2 Nov 2026' }))).toBe(
      true,
    );
  });

  it("accepts a quote from the brand's people without a source, and with one", () => {
    expect(ok(withFields('quote', { public: false }))).toBe(true);
    expect(ok(withFields('quote', { public: false, source: 'Staff meeting' }))).toBe(true);
  });

  it('needs the public flag to be said', () => {
    const { public: _p, ...noFlag } = slides.quote;
    expect(ok(noFlag)).toBe(false);
  });
});

describe('step', () => {
  it('needs n between 1 and of', () => {
    expect(ok(withFields('step', { n: 3, of: 3 }))).toBe(true);
    expect(ok(withFields('step', { n: 4, of: 3 }))).toBe(false);
    expect(ok(withFields('step', { n: 0, of: 3 }))).toBe(false);
    expect(ok(withFields('step', { n: 1.5, of: 3 }))).toBe(false);
  });
});

describe('cta', () => {
  it('has a logo or a mascot, nothing else', () => {
    expect(ok(withFields('cta', { mark: 'mascot' }))).toBe(true);
    expect(ok(withFields('cta', { mark: 'photo' }))).toBe(false);
  });
});

describe('meme: 1–2 panels', () => {
  const panel = { image, label: 'Monday' };

  it('accepts 1 or 2 panels and rejects 0 or 3', () => {
    expect(ok(withFields('meme', { panels: [panel] }))).toBe(true);
    expect(ok(withFields('meme', { panels: [panel, panel] }))).toBe(true);
    expect(ok(withFields('meme', { panels: [] }))).toBe(false);
    expect(ok(withFields('meme', { panels: [panel, panel, panel] }))).toBe(false);
  });

  it('takes a panel with the brand mascot instead of an image, never both or neither', () => {
    expect(ok(withFields('meme', { panels: [{ mascot: true, label: 'Monday' }] }))).toBe(true);
    expect(ok(withFields('meme', { panels: [{ mascot: true, image, label: 'x' }] }))).toBe(false);
    expect(ok(withFields('meme', { panels: [{ label: 'x' }] }))).toBe(false);
  });
});

describe('the image reference (§07 example, §10 crop and focus)', () => {
  const withImage = (img: unknown) => ok(withFields('step', { image: img }));

  it("accepts §07's example: an asset, a crop of x, y, width, height and a focus of center", () => {
    expect(withImage(image)).toBe(true);
  });

  it('needs only the asset', () => {
    expect(withImage({ asset: 'ast_9f2' })).toBe(true);
  });

  it('accepts a focus point as fractions of the photo', () => {
    expect(withImage({ asset: 'a', focus: { x: 0.25, y: 0.75 } })).toBe(true);
    expect(withImage({ asset: 'a', focus: { x: 0, y: 1 } })).toBe(true);
  });

  it('rejects a focus point outside the photo, or any other focus word', () => {
    expect(withImage({ asset: 'a', focus: { x: 1.1, y: 0.5 } })).toBe(false);
    expect(withImage({ asset: 'a', focus: { x: -0.1, y: 0.5 } })).toBe(false);
    expect(withImage({ asset: 'a', focus: 'somewhere' })).toBe(false);
  });

  it('rejects a crop that is not 4 whole numbers, or has no area or a negative corner', () => {
    expect(withImage({ asset: 'a', crop: [0, 0, 10] })).toBe(false);
    expect(withImage({ asset: 'a', crop: [0, 0, 10, 10, 1] })).toBe(false);
    expect(withImage({ asset: 'a', crop: [0, 0, 10.5, 10] })).toBe(false);
    expect(withImage({ asset: 'a', crop: [0, 0, 0, 10] })).toBe(false);
    expect(withImage({ asset: 'a', crop: [0, 0, 10, 0] })).toBe(false);
    expect(withImage({ asset: 'a', crop: [-1, 0, 10, 10] })).toBe(false);
  });

  it('rejects an empty asset id and unknown keys', () => {
    expect(withImage({ asset: '' })).toBe(false);
    expect(withImage({ crop: [0, 0, 10, 10] })).toBe(false);
    expect(withImage({ asset: 'a', url: 'https://example.com/x.jpg' })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { PostSchema, type Post } from './post.ts';
import { LOOK_NAMES } from './look.ts';
import { SIZE_NAMES, SIZES } from './sizes.ts';
import { banglaCarousel, slides } from './test-fixtures.ts';

const ok = (post: unknown) => PostSchema.safeParse(post).success;
const issuePaths = (post: unknown) =>
  PostSchema.safeParse(post).error?.issues.map((issue) => issue.path.join('.')) ?? [];
const post = (fields: Record<string, unknown>) => ({ ...banglaCarousel, ...fields });
const slideList = (n: number) =>
  Array.from({ length: n }, (_, i) => (i === 0 ? slides.cover : slides.text));

describe("§07's Bangla carousel example", () => {
  it('parses, and the parsed value is a Post', () => {
    const result = PostSchema.safeParse(banglaCarousel);
    expect(result.success).toBe(true);
    const parsed: Post | undefined = result.data;
    expect(parsed?.slides.map((slide) => slide.layout)).toEqual(['cover', 'cta']);
    expect(parsed?.look.name).toBe('playful');
  });

  it("is refused for its one slide as printed, since a carousel has 2–10: §07's example shows only the first", () => {
    const printed = post({ slides: banglaCarousel.slides.slice(0, 1) });
    expect(issuePaths(printed)).toEqual(['slides']);
  });

  it('rejects an unknown key at the top and in every nested object', () => {
    expect(ok(post({ extra: 1 }))).toBe(false);
    expect(ok(post({ look: { ...banglaCarousel.look, extra: 1 } }))).toBe(false);
    expect(ok(post({ look: { name: 'playful', switches: { corners: 'round', extra: 1 } } }))).toBe(
      false,
    );
    expect(ok(post({ flags: { ...banglaCarousel.flags, extra: 1 } }))).toBe(false);
    expect(ok(post({ captions: { instagram: { text: 'x', extra: 1 } } }))).toBe(false);
    expect(ok(post({ captions: { myspace: { text: 'x' } } }))).toBe(false);
  });

  it.each(['brand', 'lang', 'kind', 'networks', 'date', 'look', 'slides', 'captions', 'flags'])(
    'is refused without %s',
    (key) => {
      const { [key]: _gone, ...rest } = banglaCarousel as Record<string, unknown>;
      expect(ok(rest)).toBe(false);
    },
  );

  it('may leave out linkedTo, sources and credits for a post with no linked version', () => {
    const { linkedTo: _l, sources: _s, credits: _c, ...rest } = banglaCarousel;
    expect(ok({ ...rest, lang: 'en' })).toBe(true);
  });
});

describe('brand, lang, linkedTo, networks, date', () => {
  it('takes bn and en, and nothing else (no mixed-language posts)', () => {
    expect(ok(post({ lang: 'en' }))).toBe(true);
    expect(ok(post({ lang: 'bn-en' }))).toBe(false);
    expect(ok(post({ lang: 'fr' }))).toBe(false);
  });

  it('needs a brand and, when given, a linkedTo that is not empty', () => {
    expect(ok(post({ brand: '' }))).toBe(false);
    expect(ok(post({ linkedTo: '' }))).toBe(false);
  });

  it('takes the 7 networks, at least one, none twice', () => {
    for (const network of ['instagram', 'facebook', 'linkedin', 'x', 'threads', 'tiktok']) {
      expect(ok(post({ networks: [network] }))).toBe(true);
    }
    expect(ok(post({ networks: [] }))).toBe(false);
    expect(ok(post({ networks: ['instagram', 'instagram'] }))).toBe(false);
    expect(ok(post({ networks: ['myspace'] }))).toBe(false);
  });

  it('takes an ISO date and time with an offset, and refuses anything else', () => {
    expect(ok(post({ date: '2026-12-14T06:30:00Z' }))).toBe(true);
    expect(ok(post({ date: '2026-12-14T12:30:00+06:00' }))).toBe(true);
    expect(ok(post({ date: '2026-12-14' }))).toBe(false);
    expect(ok(post({ date: '14 Dec 2026' }))).toBe(false);
    expect(ok(post({ date: '2026-02-30T12:00:00Z' }))).toBe(false);
  });
});

describe('sizes', () => {
  it('are the five of §07 with their pixels: portrait 1080×1350, square 1080×1080, story 1080×1920, landscape 1200×675, pin 1000×1500', () => {
    expect([...SIZE_NAMES]).toEqual(['portrait', 'square', 'story', 'landscape', 'pin']);
    expect(SIZES).toEqual({
      portrait: { width: 1080, height: 1350 },
      square: { width: 1080, height: 1080 },
      story: { width: 1080, height: 1920 },
      landscape: { width: 1200, height: 675 },
      pin: { width: 1000, height: 1500 },
    });
  });
});

describe('the look', () => {
  it('is one of the four: bold, clean, editorial, playful', () => {
    expect([...LOOK_NAMES]).toEqual(['bold', 'clean', 'editorial', 'playful']);
    for (const name of LOOK_NAMES) {
      expect(ok(post({ look: { name, switches: {} } }))).toBe(true);
    }
    expect(ok(post({ look: { name: 'neon', switches: {} } }))).toBe(false);
  });

  it('may leave the switches out, or set any of the five', () => {
    expect(ok(post({ look: { name: 'bold' } }))).toBe(true);
    expect(
      ok(
        post({
          look: {
            name: 'clean',
            switches: {
              corners: 'sharp',
              frame: 'full-bleed',
              highlight: 'default',
              decorations: false,
              logo: 'bottom-left',
            },
          },
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ['corners', ['sharp', 'soft', 'round']],
    ['frame', ['none', 'print', 'rounded', 'full-bleed']],
    ['highlight', ['default', 'pill', 'underline', 'color']],
    ['decorations', [true, false]],
    ['logo', ['bottom-left', 'bottom-right', 'top']],
  ] as const)('takes for %s only its values from §07', (key, values) => {
    for (const value of values) {
      expect(ok(post({ look: { name: 'bold', switches: { [key]: value } } }))).toBe(true);
    }
    expect(ok(post({ look: { name: 'bold', switches: { [key]: 'zigzag' } } }))).toBe(false);
  });
});

describe('post kinds and their slide counts', () => {
  const kindWith = (kind: string, n: number, networks: string[] = ['instagram']) =>
    ok(post({ kind, slides: slideList(n), networks }));
  const questionSlides = (n: number) => Array.from({ length: n }, () => slides.question);

  it.each(['single', 'story'])('%s has exactly 1 slide', (kind) => {
    expect(kindWith(kind, 1)).toBe(true);
    expect(kindWith(kind, 0)).toBe(false);
    expect(kindWith(kind, 2)).toBe(false);
  });

  it('a question post has exactly 1 slide, and it is a question layout', () => {
    expect(ok(post({ kind: 'question', slides: questionSlides(1) }))).toBe(true);
    expect(ok(post({ kind: 'question', slides: questionSlides(0) }))).toBe(false);
    expect(ok(post({ kind: 'question', slides: questionSlides(2) }))).toBe(false);
    expect(ok(post({ kind: 'question', slides: [slides.cover] }))).toBe(false);
  });

  it('a text-only post has 0 slides', () => {
    expect(kindWith('textOnly', 0, ['linkedin'])).toBe(true);
    expect(kindWith('textOnly', 1, ['linkedin'])).toBe(false);
  });

  it.each(['carousel', 'document'])('a %s has 2 to 10 slides', (kind) => {
    expect(kindWith(kind, 0)).toBe(false);
    expect(kindWith(kind, 1)).toBe(false);
    expect(kindWith(kind, 2)).toBe(true);
    expect(kindWith(kind, 10)).toBe(true);
    expect(kindWith(kind, 11)).toBe(false);
  });

  it('refuses a kind that is not one of the six', () => {
    expect(kindWith('video', 1)).toBe(false);
    expect(kindWith('linkedin-document', 3)).toBe(false);
  });

  it('a carousel for Pinterest has at most 5 slides', () => {
    expect(kindWith('carousel', 5, ['pinterest'])).toBe(true);
    expect(kindWith('carousel', 6, ['pinterest'])).toBe(false);
    expect(kindWith('carousel', 6, ['instagram', 'pinterest'])).toBe(false);
  });

  it('a carousel for X has at most 4 slides', () => {
    expect(kindWith('carousel', 4, ['x'])).toBe(true);
    expect(kindWith('carousel', 5, ['x'])).toBe(false);
    expect(kindWith('carousel', 5, ['facebook', 'x'])).toBe(false);
  });

  it('the Pinterest and X caps are for carousels: a LinkedIn document may have 10 slides', () => {
    expect(kindWith('document', 10, ['linkedin'])).toBe(true);
  });

  it('reports the slide count on the slides path', () => {
    expect(issuePaths(post({ kind: 'carousel', slides: slideList(11) }))).toContain('slides');
    expect(issuePaths(post({ kind: 'carousel', slides: slideList(5), networks: ['x'] }))).toEqual([
      'slides',
    ]);
  });

  it('rejects a slide that is not a valid slide, with the path to it', () => {
    const bad = post({ slides: [slides.cover, { ...slides.cta, alt: '' }] });
    expect(issuePaths(bad)).toEqual(['slides.1.alt']);
  });
});

describe('captions', () => {
  it('may hold one caption per network, with hashtags and a title', () => {
    expect(
      ok(
        post({
          captions: {
            pinterest: { text: 'x', title: 'A title', hashtags: ['#pitha'] },
            x: { text: 'y' },
          },
        }),
      ),
    ).toBe(true);
    expect(ok(post({ captions: {} }))).toBe(true);
  });

  it('refuses a hashtag that does not start with # or has a space; caption length is not checked here', () => {
    expect(ok(post({ captions: { instagram: { text: 'x', hashtags: ['pitha'] } } }))).toBe(false);
    expect(ok(post({ captions: { instagram: { text: 'x', hashtags: ['#two words'] } } }))).toBe(
      false,
    );
    expect(ok(post({ captions: { instagram: { text: 'x'.repeat(5000) } } }))).toBe(true);
  });
});

describe('sources and credits', () => {
  it('are lists of text', () => {
    expect(ok(post({ sources: ['Bangla Academy, 2019'], credits: ['Photo: the cafe'] }))).toBe(
      true,
    );
    expect(ok(post({ sources: [''] }))).toBe(false);
    expect(ok(post({ credits: [1] }))).toBe(false);
  });
});

describe('flags', () => {
  it('carry aiImage, claimsConfirmed and testimonialConsent, null until set', () => {
    expect(
      ok(post({ flags: { aiImage: true, claimsConfirmed: true, testimonialConsent: false } })),
    ).toBe(true);
    expect(
      ok(post({ flags: { aiImage: false, claimsConfirmed: null, testimonialConsent: null } })),
    ).toBe(true);
  });

  it('are all present: a missing flag is refused, as is a value that is not a boolean or null', () => {
    expect(ok(post({ flags: { aiImage: false, claimsConfirmed: null } }))).toBe(false);
    expect(
      ok(post({ flags: { aiImage: null, claimsConfirmed: null, testimonialConsent: null } })),
    ).toBe(false);
    expect(
      ok(post({ flags: { aiImage: false, claimsConfirmed: 'yes', testimonialConsent: null } })),
    ).toBe(false);
  });

  it('may stay null on a post that has claims or a testimonial: setting them is checked at approval (§11), not here', () => {
    const testimonial = post({ kind: 'single', slides: [slides.testimonial] });
    expect(ok(testimonial)).toBe(true);
  });
});

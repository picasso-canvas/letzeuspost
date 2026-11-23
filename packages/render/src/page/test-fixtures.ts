// Valid sample content for the page tests: a kit, a post with a `text` slide and a look made only for tests (the
// real looks come in their own tasks, §08).
import type { Post } from '@lzp/core';
import type { LookDefinition, RenderKit } from '../kit.ts';

export type TextSlide = Extract<Post['slides'][number], { layout: 'text' }>;

export function testKit(overrides: Partial<RenderKit> = {}): RenderKit {
  return {
    colors: {
      primary: '#e4572e',
      accent: '#17bebb',
      background: '#fff8f0',
      ink: '#1b1b1b',
      extras: ['#ffc914'],
    },
    fonts: {
      en: { heading: 'Nunito', body: 'Nunito' },
      bn: { heading: 'Hind Siliguri', body: 'Hind Siliguri' },
    },
    logo: { light: 'logo_light_1', dark: 'logo_dark_1' },
    ...overrides,
  };
}

export function testSlide(overrides: Partial<TextSlide> = {}): TextSlide {
  return {
    layout: 'text',
    kicker: 'Did you know',
    title: 'Pitha is *older* than tea',
    body: 'Rice cakes were made here for centuries.',
    source: 'Bangla Academy, 2019',
    alt: 'A plate of pitha',
    ...overrides,
  };
}

export function testPost(slide: TextSlide = testSlide(), overrides: Partial<Post> = {}): Post {
  return {
    brand: 'golpo',
    lang: 'en',
    kind: 'single',
    networks: ['instagram'],
    date: '2026-12-14T12:30:00+06:00',
    look: { name: 'clean', switches: {} },
    slides: [slide],
    captions: {},
    flags: { aiImage: false, claimsConfirmed: null, testimonialConsent: null },
    ...overrides,
  };
}

/** A post in Bangla, with a Bangla `text` slide. */
export function testBanglaPost(): Post {
  const slide = testSlide({
    kicker: 'শীতের গল্প',
    title: 'ফিরে এল *পিঠা* সপ্তাহ',
    body: 'এই শীতে আমরা নিয়ে এসেছি পুরনো দিনের স্বাদ।',
    source: 'বাংলা একাডেমি',
    alt: 'পিঠার থালা',
  });
  return testPost(slide, { lang: 'bn' });
}

/** The look the page tests register: `clean` by name, with a CSS rule and a token that the tests can look for. */
export const TEST_LOOK: LookDefinition = {
  name: 'clean',
  version: 3,
  css: '.look-test-marker { color: var(--look-test-token); }',
  tokens: { 'look-test-token': '#123456' },
};

import type { Post } from '@lzp/core';
import { describe, expect, it } from 'vitest';
import { testKit, testPost, testSlide } from '../page/test-fixtures.ts';
import {
  renderKey,
  type DocumentKeyInput,
  type ImageKeyInput,
  type RenderKeyInput,
} from './key.ts';

// The cache key (§08 When renders happen, and caching): a hash of the renderer version, the look version, the brand's
// tokens and fonts, the slide content, the image assets with their crops, the size and the format. Every one of them
// changes the key; nothing else does.

const PHOTO = { key: 'ast_9f2', sha256: 'a'.repeat(64) };
const LOGO = { key: 'logo_light_1', sha256: 'b'.repeat(64) };

type CoverSlide = Extract<Post['slides'][number], { layout: 'cover' }>;

/** A cover slide with a photo, so the crop is part of the slide. */
const cover = (overrides: Partial<CoverSlide> = {}): CoverSlide => ({
  layout: 'cover',
  kicker: 'Winter stories',
  title: 'Pitha week is *back*',
  image: { asset: 'ast_9f2', crop: [0, 120, 1080, 900], focus: 'center' },
  alt: 'A plate of pitha',
  ...overrides,
});

const carousel = (slides: Post['slides'] = [cover(), testSlide()]): Post =>
  testPost(testSlide(), { kind: 'carousel', slides });

function image(overrides: Partial<ImageKeyInput> = {}): RenderKeyInput {
  return {
    rendererVersion: 1,
    lookVersion: 3,
    kit: testKit(),
    post: carousel(),
    slide: 0,
    assets: [PHOTO, LOGO],
    size: 'portrait',
    format: 'jpeg',
    ...overrides,
  };
}

function pdf(overrides: Partial<DocumentKeyInput> = {}): RenderKeyInput {
  return {
    rendererVersion: 1,
    lookVersion: 3,
    kit: testKit(),
    post: carousel(),
    assets: [PHOTO, LOGO],
    size: 'portrait',
    format: 'pdf',
    title: 'Pitha week is back',
    ...overrides,
  };
}

const KEY = renderKey(image());

describe('renderKey', () => {
  it('is a sha256 in hex, the same for the same input every time', () => {
    expect(KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(renderKey(image())).toBe(KEY);
    expect(renderKey(structuredClone(image()))).toBe(KEY);
  });

  it('does not depend on the order of object keys or of the assets', () => {
    const kit = testKit();
    const reordered = {
      mascot: kit.mascot,
      logo: { dark: kit.logo.dark, light: kit.logo.light },
      fonts: { bn: kit.fonts.bn, en: { body: kit.fonts.en.body, heading: kit.fonts.en.heading } },
      colors: { ...kit.colors },
    };
    expect(renderKey(image({ kit: reordered, assets: [LOGO, PHOTO] }))).toBe(KEY);
  });

  const kit = testKit();
  const changes: [string, RenderKeyInput][] = [
    ['the renderer version', image({ rendererVersion: 2 })],
    ['the look version', image({ lookVersion: 4 })],
    ['the look', image({ post: { ...carousel(), look: { name: 'playful', switches: {} } } })],
    [
      'a look switch',
      image({ post: { ...carousel(), look: { name: 'clean', switches: { corners: 'round' } } } }),
    ],
    ['a brand colour', image({ kit: { ...kit, colors: { ...kit.colors, primary: '#123456' } } })],
    [
      'an extra brand colour',
      image({ kit: { ...kit, colors: { ...kit.colors, extras: ['#ffc914', '#000000'] } } }),
    ],
    [
      'the brand’s heading font',
      image({
        kit: { ...kit, fonts: { ...kit.fonts, en: { heading: 'Baloo 2', body: 'Nunito' } } },
      }),
    ],
    ['the brand’s logo', image({ kit: { ...kit, logo: { ...kit.logo, light: 'logo_light_2' } } })],
    ['the brand’s mascot', image({ kit: { ...kit, mascot: 'mascot_1' } })],
    [
      'the slide’s title',
      image({ post: carousel([cover({ title: 'Pitha week is here' }), testSlide()]) }),
    ],
    ['the slide’s alt text', image({ post: carousel([cover({ alt: 'Pitha' }), testSlide()]) })],
    [
      'the photo’s crop',
      image({
        post: carousel([
          cover({ image: { asset: 'ast_9f2', crop: [0, 0, 1080, 900], focus: 'center' } }),
          testSlide(),
        ]),
      }),
    ],
    [
      'the photo’s focus point',
      image({
        post: carousel([
          cover({
            image: { asset: 'ast_9f2', crop: [0, 120, 1080, 900], focus: { x: 0.2, y: 0.4 } },
          }),
          testSlide(),
        ]),
      }),
    ],
    [
      'which slide it is (its page number)',
      image({ post: carousel([testSlide(), cover()]), slide: 1 }),
    ],
    ['how many slides there are', image({ post: carousel([cover(), testSlide(), testSlide()]) })],
    ['the language', image({ post: { ...carousel(), lang: 'bn' } })],
    ['an image asset’s bytes', image({ assets: [{ ...PHOTO, sha256: 'c'.repeat(64) }, LOGO] })],
    ['a different image asset', image({ assets: [{ ...PHOTO, key: 'ast_9f3' }, LOGO] })],
    ['the size', image({ size: 'square' })],
    ['the format', image({ format: 'png' })],
    ['the format (thumbnail)', image({ format: 'webp' })],
    ['the format (PDF)', pdf()],
  ];

  it.each(changes)('changes with %s', (_, changed) => {
    expect(renderKey(changed)).not.toBe(KEY);
  });

  const unrelated: [string, RenderKeyInput][] = [
    ['the captions', image({ post: { ...carousel(), captions: { instagram: { text: 'New!' } } } })],
    ['the date', image({ post: { ...carousel(), date: '2026-12-20T09:00:00+06:00' } })],
    ['the networks', image({ post: { ...carousel(), networks: ['instagram', 'facebook'] } })],
    [
      'the flags',
      image({
        post: {
          ...carousel(),
          flags: { aiImage: true, claimsConfirmed: true, testimonialConsent: null },
        },
      }),
    ],
    ['the brand id', image({ post: { ...carousel(), brand: 'other' } })],
    ['the linked post', image({ post: { ...carousel(), linkedTo: 'post_123_bn' } })],
    ['the post’s sources list', image({ post: { ...carousel(), sources: ['Bangla Academy'] } })],
    [
      'another slide’s text',
      image({
        post: carousel([cover(), testSlide({ title: 'Something else' })]),
      }),
    ],
    [
      'the Bangla fonts of an English post',
      image({
        kit: { ...kit, fonts: { ...kit.fonts, bn: { heading: 'Baloo Da 2', body: 'Baloo Da 2' } } },
      }),
    ],
  ];

  it.each(unrelated)('stays the same when only %s changes', (_, changed) => {
    expect(renderKey(changed)).toBe(KEY);
  });

  it('for the PDF, changes with any slide’s content and with the title (the hook)', () => {
    const base = renderKey(pdf());
    expect(renderKey(pdf())).toBe(base);
    expect(
      renderKey(pdf({ post: carousel([cover(), testSlide({ body: 'Other words.' })]) })),
    ).not.toBe(base);
    expect(renderKey(pdf({ title: 'Pitha week returns' }))).not.toBe(base);
    expect(
      renderKey(pdf({ post: { ...carousel(), captions: { linkedin: { text: 'New!' } } } })),
    ).toBe(base);
  });

  it('refuses a slide that is not in the post', () => {
    expect(() => renderKey(image({ slide: 2 }))).toThrow(/slide/);
    expect(() => renderKey(image({ slide: -1 }))).toThrow(/slide/);
  });
});

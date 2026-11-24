import { createHash } from 'node:crypto';
import type { Post, SizeName } from '@lzp/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FitReport } from '../fit/report.ts';
import { buildSlide } from '../page/build-slide.ts';
import { registerLook } from '../page/looks.ts';
import { TEST_LOOK, testBanglaPost, testKit, testPost, testSlide } from '../page/test-fixtures.ts';
import { buildDocument } from './document.ts';

// The LinkedIn PDF's page (§08 Outputs): every slide of the post in one HTML document, one page each, made from the
// same pages the images are drawn from, each at the `--k` its image render used.

beforeAll(() => {
  registerLook(TEST_LOOK);
});

const post = (): Post =>
  testPost(testSlide(), {
    kind: 'document',
    networks: ['linkedin'],
    slides: [
      testSlide({ title: 'Pitha is *older* than tea' }),
      testSlide({ title: 'Rice, jaggery and coconut', body: 'Three things, one winter.' }),
      testSlide({ title: 'Come taste it', body: 'All week at the stall.' }),
    ],
  });

const report = (slide: number, k: number, size: SizeName = 'portrait'): FitReport => ({
  size,
  slide,
  k,
  status: 'pass',
  fields: [],
});

const REPORTS = [report(1, 1), report(2, 0.91), report(3, 0.85)];
const HOOK = 'Pitha is older than tea';

const build = (overrides: Partial<Parameters<typeof buildDocument>[0]> = {}) =>
  buildDocument({
    post: post(),
    size: 'portrait',
    kit: testKit(),
    reports: REPORTS,
    title: HOOK,
    ...overrides,
  });

const styleOf = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
const policyOf = (html: string) =>
  /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '';
/** The `<main>` of a page `buildSlide` made: the slide as the image shows it. */
const mainOf = (html: string) => /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? '';

describe('buildDocument', () => {
  it('has one page per slide, in order, each the slide’s own markup from buildSlide', () => {
    const html = build();
    const pages = [
      ...html.matchAll(/<section class="pdf-page pdf-page-(\d+)">([\s\S]*?)<\/section>/g),
    ];
    expect(pages.map((page) => page[1])).toEqual(['1', '2', '3']);
    post().slides.forEach((slide, index) => {
      const page = buildSlide(post(), slide, 'portrait', testKit());
      expect(pages[index]?.[2]).toBe(mainOf(page));
    });
  });

  it('uses the image pages’ own style, body classes and language', () => {
    const html = build();
    const page = buildSlide(post(), post().slides[0] ?? testSlide(), 'portrait', testKit());
    expect(styleOf(html).startsWith(styleOf(page))).toBe(true);
    expect(/<body class="([^"]*)"/.exec(html)?.[1]).toBe(/<body class="([^"]*)"/.exec(page)?.[1]);
    expect(html.startsWith('<!DOCTYPE html><html lang="en">')).toBe(true);
    const bangla = testBanglaPost();
    const bn = buildDocument({
      post: bangla,
      size: 'portrait',
      kit: testKit(),
      reports: [report(1, 1)],
      title: 'পিঠা',
    });
    expect(bn.startsWith('<!DOCTYPE html><html lang="bn">')).toBe(true);
    expect(bn).toContain('ফিরে এল <mark class="hl">পিঠা</mark> সপ্তাহ');
  });

  it('prints each page at the slide’s size with no margins', () => {
    expect(styleOf(build())).toMatch(/@page\s*{\s*size:\s*1080px 1350px;\s*margin:\s*0;\s*}/);
    const landscape = build({
      size: 'landscape',
      reports: REPORTS.map((r) => ({ ...r, size: 'landscape' as const })),
    });
    expect(styleOf(landscape)).toMatch(/@page\s*{\s*size:\s*1200px 675px;\s*margin:\s*0;\s*}/);
  });

  it('gives each page the k of its slide’s fit report', () => {
    const style = styleOf(build());
    expect(style).toMatch(/\.pdf-page-1\s*{\s*--k:\s*1;\s*}/);
    expect(style).toMatch(/\.pdf-page-2\s*{\s*--k:\s*0\.91;\s*}/);
    expect(style).toMatch(/\.pdf-page-3\s*{\s*--k:\s*0\.85;\s*}/);
  });

  it('is titled with the hook, as text', () => {
    expect(build()).toContain(`<title>${HOOK}</title>`);
    const nasty = build({ title: '<script>alert(1)</script> & "tea"' });
    expect(nasty).toContain(
      '<title>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;tea&quot;</title>',
    );
    expect(nasty).not.toContain('<script');
  });

  it('runs no script: the policy allows none, and only its one style by hash', () => {
    const html = build();
    expect(html).not.toContain('<script');
    const policy = policyOf(html);
    expect(policy).not.toContain('script-src');
    expect(policy).toContain("default-src 'none'");
    const hash = createHash('sha256').update(styleOf(html)).digest('base64');
    expect(policy).toContain(`style-src 'sha256-${hash}'`);
    expect(policy).toContain('img-src lzp-asset:');
    expect(policy).toContain('font-src lzp-asset:');
  });

  it('refuses fit reports that are not one per slide, in order, at the size', () => {
    expect(() => build({ reports: REPORTS.slice(0, 2) })).toThrow(/fit report/);
    expect(() => build({ reports: [REPORTS[1], REPORTS[0], REPORTS[2]] as FitReport[] })).toThrow(
      /fit report/,
    );
    expect(() =>
      build({ reports: [report(1, 1, 'square'), REPORTS[1], REPORTS[2]] as FitReport[] }),
    ).toThrow(/fit report/);
  });

  it('refuses an empty title: LinkedIn asks for one', () => {
    expect(() => build({ title: '  ' })).toThrow(/title/);
  });
});

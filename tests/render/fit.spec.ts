import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import type { SizeName } from '../../packages/core/src/index.ts';
import { contextOptions, LAUNCH_OPTIONS } from '../../packages/render/src/browser/flags.ts';
import {
  assetIndex,
  findAsset,
  PAGE_URL,
  servedHtml,
  type RenderAsset,
} from '../../packages/render/src/browser/requests.ts';
import { buildFitReport, PageFitSchema } from '../../packages/render/src/fit/report.ts';
import { FONT_MANIFEST } from '../../packages/render/src/fonts/library.ts';
import { loadFonts } from '../../packages/render/src/fonts/load.ts';
import { sha256Base64 } from '../../packages/render/src/page/sha256.ts';
import { testPost, testSlide } from '../../packages/render/src/page/test-fixtures.ts';
import { SIZE_NAMES, SIZES, SMALL_PRINT_PX } from '../../packages/render/src/sizes.ts';
import { slidePage } from './slides.ts';

// The fit script in a real Chromium (§08 The fit check; #334). These run in CI's services job, the `render`
// Playwright project. They load `buildSlide`'s own page under its own content policy, with the manifest fonts, and
// read what the script reports and what the page measures. The page runner (#333) isn't in the path: the report is
// read from the page directly (`window.lzpFit`).

const LOGO: RenderAsset = {
  kind: 'image',
  key: 'logo_light_1',
  contentType: 'image/png',
  data: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
};

const fontAssets = loadFonts(FONT_MANIFEST).then((fonts) =>
  fonts.flatMap((font) =>
    font.files.map((file): RenderAsset => ({
      kind: 'font',
      key: file.sha256,
      contentType: 'font/woff2',
      data: file.data,
    })),
  ),
);

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch(LAUNCH_OPTIONS);
});

test.afterEach(async () => {
  await Promise.all(browser.contexts().map((context) => context.close()));
});

test.afterAll(async () => {
  await browser.close();
});

/** A page, loaded as the render browser loads it: its own content policy, the job's assets and nothing else. */
async function open(html: string, size: SizeName): Promise<{ page: Page; violations: string[] }> {
  const index = assetIndex([LOGO, ...(await fontAssets)]);
  const context = await browser.newContext(contextOptions(size));
  await context.route('**/*', async (route, request) => {
    const asset = request.isNavigationRequest() ? undefined : findAsset(index, request.url());
    if (request.url() === PAGE_URL && request.isNavigationRequest())
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: servedHtml(html),
      });
    else if (asset !== undefined)
      await route.fulfill({
        status: 200,
        contentType: asset.contentType,
        body: Buffer.from(asset.data),
      });
    else await route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  await page.goto(PAGE_URL, { waitUntil: 'load' });
  return { page, violations };
}

/** What the fit script reported, checked against the shape the report is built from. */
async function fitOf(page: Page) {
  return PageFitSchema.parse(await page.evaluate('window.lzpFit'));
}

const STYLE = /<style>([\s\S]*?)<\/style>/;

/** The page with more CSS in its one `<style>`, and the content policy told the style's new hash. */
function withCss(html: string, css: string): string {
  const old = STYLE.exec(html)?.[1];
  if (old === undefined) throw new Error('no style');
  const style = `${old}\n${css}`;
  return html
    .replace(STYLE, () => `<style>${style}</style>`)
    .replace(`sha256-${sha256Base64(old)}`, `sha256-${sha256Base64(style)}`);
}

const TEXT_AREA = '<div class="text-area">';

/** The page with an empty block of `height` px first in the text area: room the text can't use. */
const withSpacer = (html: string, height: number): string =>
  withCss(
    html.replace(TEXT_AREA, `${TEXT_AREA}<div class="spacer"></div>`),
    `.spacer { flex: none; height: ${String(height)}px; }`,
  );

/** The page with an image box first in the text area (the layouts that draw photos use the same class). */
const withImageBox = (html: string): string =>
  html.replace(TEXT_AREA, `${TEXT_AREA}<div class="image-box"></div>`);

/** How tall the text area's content is at each `k`, and the room it has. Sets `--k` on the page. */
async function neededAt(page: Page, ks: readonly number[]) {
  return page.evaluate<{ k: number; needed: number; room: number }[]>(`(() => {
    const area = document.querySelector('.text-area');
    return ${JSON.stringify(ks)}.map((k) => {
      document.documentElement.style.setProperty('--k', String(k));
      const boxes = [...area.children].map((child) => child.getBoundingClientRect());
      return {
        k,
        needed: Math.max(...boxes.map((box) => box.bottom)) - Math.min(...boxes.map((box) => box.top)),
        room: area.getBoundingClientRect().height,
      };
    });
  })()`);
}

const STEPS = Array.from({ length: 16 }, (_, i) => (100 - i) / 100);

/**
 * A page whose text fits at `k` and at no larger k: an empty block takes the room the text doesn't need at `k`. The
 * text's height at each k comes from the page itself; a text whose height doesn't fall by at least 2 px with every
 * step down is no basis for this, and the test says so.
 */
async function pageNeeding(k: number, size: SizeName = 'portrait'): Promise<string> {
  const post = testPost(
    testSlide({
      title: 'Pitha is *older* than tea and so is the rice cake itself',
      body: 'Rice cakes were made here for centuries, long before tea came to the delta, and families still make them each winter.',
    }),
  );
  const html = await slidePage(post, size);
  const { page } = await open(withSpacer(html, 0), size);
  await fitOf(page);
  const rows = await neededAt(page, STEPS);
  const here = rows.find((row) => row.k === k);
  if (here === undefined) throw new Error(`no k ${String(k)}`);
  for (const row of rows.filter((other) => other.k > k))
    expect(row.needed - here.needed, `needed at ${String(row.k)} vs ${String(k)}`).toBeGreaterThan(
      2,
    );
  return withSpacer(html, Math.floor(here.room - here.needed));
}

test('runs under its content policy, and reports when the fonts are loaded and the images decoded', async () => {
  const { page, violations } = await open(await slidePage(testPost()), 'portrait');
  const done = await page.evaluate<{ fonts: boolean; images: boolean }>(
    `window.lzpFit.then(() => ({
      fonts: document.fonts.size > 0 && [...document.fonts].every((face) => face.status === 'loaded'),
      images: document.images.length > 0 && [...document.images].every((image) => image.complete && image.naturalWidth > 0),
    }))`,
  );
  expect(done).toEqual({ fonts: true, images: true });
  expect(await page.evaluate('document.documentElement.dataset.fit')).toBe('done');
  expect(violations).toEqual([]);
});

test.describe('the scale it picks', () => {
  test('a slide that fits at 1.00 reports k 1 and fits', async () => {
    const { page } = await open(await slidePage(testPost()), 'portrait');
    expect(await fitOf(page)).toEqual({ k: 1, fits: true, fields: [] });
    expect(await page.evaluate('document.documentElement.style.getPropertyValue("--k")')).toBe('1');
  });

  test('a slide that needs 0.90 reports 0.90, and the page stays at it', async () => {
    const { page } = await open(await pageNeeding(0.9), 'portrait');
    expect(await fitOf(page)).toEqual({ k: 0.9, fits: true, fields: [] });
    expect(await page.evaluate('document.documentElement.style.getPropertyValue("--k")')).toBe(
      '0.9',
    );
  });

  for (const k of [0.99, 0.95, 0.86, 0.85])
    test(`the largest k that fits, to the hundredth: ${String(k)}`, async () => {
      const { page } = await open(await pageNeeding(k), 'portrait');
      expect(await fitOf(page)).toEqual({ k, fits: true, fields: [] });
    });
});

/** A title far too long for any size: the same sentence, eight times. */
const LONG_TITLE = Array.from(
  { length: 8 },
  () => 'Pitha is older than tea and so is the rice cake itself',
).join(' ');

/** How far past the text area the content of its tallest column reaches, and how many lines the title has. */
const OVERFLOW = `(() => {
  const area = document.querySelector('.text-area');
  const columns = [...document.querySelectorAll('.col')];
  const heights = (columns.length > 0 ? columns : [area]).map((container) => {
    const boxes = [...container.children].map((child) => child.getBoundingClientRect());
    return Math.max(...boxes.map((box) => box.bottom)) - Math.min(...boxes.map((box) => box.top));
  });
  const title = document.querySelector('.title');
  return {
    excess: Math.max(...heights) - area.getBoundingClientRect().height,
    lines: Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)),
  };
})()`;

test.describe('a slide that does not fit at 0.85', () => {
  for (const size of ['portrait', 'landscape'] as const)
    test(`${size}: fails at 0.85 and names the title with its lines, graphemes, overflow and target`, async () => {
      const post = testPost(testSlide({ title: LONG_TITLE }));
      const { page } = await open(await slidePage(post, size), size);
      const fit = await fitOf(page);
      expect(fit).toMatchObject({ k: 0.85, fits: false });
      expect(await page.evaluate('document.documentElement.style.getPropertyValue("--k")')).toBe(
        '0.85',
      );

      const measured = await page.evaluate<{ excess: number; lines: number }>(OVERFLOW);
      // Only the title has lines to give back: the kicker and the body are one line each, the source is small print.
      expect(fit.fields.map((field) => field.name)).toEqual(['title']);
      const [title] = fit.fields;
      expect(title?.lines).toBe(measured.lines);
      expect(title?.lines).toBeGreaterThan(4);
      expect(title?.overflowPx).toBeCloseTo(measured.excess, 0);
      expect(title?.available).toBeLessThan(title?.needed ?? 0);

      const report = buildFitReport(post, 0, size, fit);
      expect(report).toMatchObject({ size, slide: 1, k: 0.85, status: 'fail' });
      expect(report.fields).toHaveLength(1);
      expect(report.fields[0]).toMatchObject({
        field: 'slides[0].title',
        lines: measured.lines,
        graphemes: LONG_TITLE.length,
      });
      expect(report.fields[0]?.targetGraphemes).toBeGreaterThan(0);
      expect(report.fields[0]?.targetGraphemes).toBeLessThan(LONG_TITLE.length);
    });
});

/** The sizes of the text and the small print at every k from 1.00 to 0.85, read from the page's own CSS. */
const SIZES_AT_EVERY_K = `(() => {
  const px = (selector) => [...document.querySelectorAll(selector)].map((el) => parseFloat(getComputedStyle(el).fontSize));
  return ${JSON.stringify(STEPS)}.map((k) => {
    document.documentElement.style.setProperty('--k', String(k));
    return { k, title: px('.title')[0], body: px('.body')[0], small: [...px('.small-print'), ...px('.page-number')] };
  });
})()`;

test.describe('the floors', () => {
  for (const size of SIZE_NAMES)
    test(`${size}: body never under ${String(SIZES[size].bodyFloor)} px, small print always ${String(SMALL_PRINT_PX)} px, at every k`, async () => {
      // Two slides, so the page number is drawn too
      const post = testPost(testSlide(), { slides: [testSlide(), testSlide()] });
      const { page } = await open(await slidePage(post, size), size);
      await fitOf(page);
      const rows =
        await page.evaluate<{ k: number; title: number; body: number; small: number[] }[]>(
          SIZES_AT_EVERY_K,
        );
      const first = rows[0];
      if (first === undefined) throw new Error('no rows');
      for (const row of rows) {
        expect(row.body).toBeGreaterThanOrEqual(SIZES[size].bodyFloor);
        expect(row.body).toBeCloseTo(Math.max(SIZES[size].bodyFloor, first.body * row.k), 3);
        expect(row.small.length).toBeGreaterThanOrEqual(2); // the source and the page number
        for (const small of row.small) expect(small).toBe(SMALL_PRINT_PX);
        // The title does scale: this is the same page with --k lowered
        expect(row.title).toBeCloseTo(first.title * row.k, 3);
      }
    });
});

test.describe('image boxes', () => {
  /** The image box's height at every k from 1.00 to 0.85, and the page's. */
  const IMAGE_BOX_AT_EVERY_K = `(() => {
    const box = document.querySelector('.image-box');
    return {
      page: document.body.getBoundingClientRect().height,
      heights: ${JSON.stringify(STEPS)}.map((k) => {
        document.documentElement.style.setProperty('--k', String(k));
        return box.getBoundingClientRect().height;
      }),
    };
  })()`;

  for (const size of ['portrait', 'story'] as const) {
    test(`${size}: keeps 26% of the height at every k, with a little text and with far too much`, async () => {
      for (const title of ['Pitha', LONG_TITLE]) {
        const post = testPost(testSlide({ title }));
        const { page } = await open(withImageBox(await slidePage(post, size)), size);
        const fit = await fitOf(page);
        const { page: height, heights } = await page.evaluate<{ page: number; heights: number[] }>(
          IMAGE_BOX_AT_EVERY_K,
        );
        expect(height).toBe(SIZES[size].height);
        for (const box of heights) expect(box).toBeGreaterThanOrEqual(0.26 * height - 0.5);
        // The text is what gives way: with too much of it the page doesn't fit, and the photo is still there
        expect(fit.fits).toBe(title === 'Pitha');
      }
    });
  }
});

/** A Bangla post with the title given. */
const bangla = (title: string) =>
  testPost(
    testSlide({
      kicker: 'শীতের গল্প',
      title,
      body: 'এই শীতে আমরা নিয়ে এসেছি পুরনো দিনের স্বাদ।',
      source: 'বাংলা একাডেমি',
      alt: 'পিঠার থালা',
    }),
    { lang: 'bn' },
  );

/** The title's box: its height, its line height and its font size, in pixels. */
const TITLE_BOX = `(() => {
  const title = document.querySelector('.title');
  const style = getComputedStyle(title);
  return {
    height: title.getBoundingClientRect().height,
    lineHeight: parseFloat(style.lineHeight),
    fontSize: parseFloat(style.fontSize),
  };
})()`;

test.describe('Bangla', () => {
  test('tall conjuncts are measured by the block box: a line is as tall as a line of plain letters', async () => {
    const boxes = [];
    for (const title of ['ক্ষ্ম্য স্ত্রী শ্রী', 'কক কক কক']) {
      const { page } = await open(await slidePage(bangla(title)), 'portrait');
      const fit = await fitOf(page);
      expect(fit).toEqual({ k: 1, fits: true, fields: [] });
      boxes.push(
        await page.evaluate<{ height: number; lineHeight: number; fontSize: number }>(TITLE_BOX),
      );
    }
    const [tall, plain] = boxes;
    if (tall === undefined || plain === undefined) throw new Error('no boxes');
    // The same box either way: lines × line height, whatever the glyphs reach to above and below
    expect(tall.height).toBe(plain.height);
    expect(tall.height).toBe(tall.lineHeight);
    // And the line height leaves room for the stacked conjuncts: at least 1.3 for headings (§07)
    expect(tall.lineHeight / tall.fontSize).toBeGreaterThanOrEqual(1.3);
  });

  test('a hand-made too-long Bangla title is caught, named by its path with its grapheme count by hand', async () => {
    // 'ক্ষত' is 2 graphemes (ক্ষ and ত): 150 words, 149 spaces → 150 × 2 + 149 = 449
    const title = Array.from({ length: 150 }, () => 'ক্ষত').join(' ');
    const post = bangla(title);
    const { page } = await open(await slidePage(post), 'portrait');
    const fit = await fitOf(page);
    expect(fit).toMatchObject({ k: 0.85, fits: false });

    const report = buildFitReport(post, 0, 'portrait', fit);
    expect(report.status).toBe('fail');
    const [field] = report.fields;
    expect(field).toMatchObject({ field: 'slides[0].title', graphemes: 449 });
    expect(field?.lines).toBeGreaterThan(4);
    expect(field?.overflowPx).toBeGreaterThan(0);
    expect(field?.targetGraphemes).toBeGreaterThan(0);
    expect(field?.targetGraphemes).toBeLessThan(449);
  });
});

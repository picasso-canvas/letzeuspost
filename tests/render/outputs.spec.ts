import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Post } from '../../packages/core/src/index.ts';
import {
  createRenderer,
  type Log,
  type RenderAsset,
} from '../../packages/render/src/browser/index.ts';
import type { FitReport } from '../../packages/render/src/fit/report.ts';
import { toJpeg } from '../../packages/render/src/output/images.ts';
import {
  testBanglaPost,
  testPost,
  testSlide,
} from '../../packages/render/src/page/test-fixtures.ts';
import { documentPrinter, printPost, type DocumentPrinter } from './documents.ts';
import { renderPostSlide } from './slides.ts';

// The LinkedIn PDF in a real Chromium (§08 Outputs, §12 LinkedIn carousel PDF; #337): every slide of a post rendered as
// an image, its PNG master made into the JPEG, and the PDF printed from the same pages at each slide's `k`. The PDF is
// read back with pdf.js (pdfjs-dist, Apache-2.0) inside a browser page: its pages, their size, its title, its text, and
// each page rasterised and compared with its slide's JPEG. These run in CI's services job, the `render` Playwright
// project.

const LOGO: RenderAsset = {
  kind: 'image',
  key: 'logo_light_1',
  contentType: 'image/png',
  data: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
};

const HOOK = 'Pitha is older than tea';
// Long enough that the fit script lowers its `k`, so the page can only match its JPEG at that `k`.
const LONGER =
  'Rice, jaggery and coconut, folded by hand in every kitchen of the village each winter';

const carousel = (): Post =>
  testPost(testSlide(), {
    kind: 'document',
    networks: ['linkedin'],
    slides: [
      testSlide({ title: 'Pitha is *older* than tea' }),
      testSlide({ title: LONGER, body: 'Three things, one winter.' }),
      testSlide({ title: 'Come taste it', body: 'All week at the stall.' }),
    ],
  });

// The tolerance a page is held to against its JPEG. The two are drawn by different rasterisers (Chrome's Skia for the
// image, pdf.js for the page), so glyph edges differ by a fraction of a pixel, and the JPEG has its own small loss.
// Over the whole image: the mean difference per colour channel at most 3 of 255, and at most 2% of the pixels
// differing by more than 64 in any channel. A page drawn at another `k`, or another slide, is far outside it (the last
// test checks that it is).
const TOLERANCE = { meanChannel: 3, farShare: 0.02, far: 64 } as const;
// A PDF page is in points, the image in CSS pixels: 72 points to 96 pixels. Chrome may round a page's size, so a page
// is held to its image's size within a point.
const POINTS_PER_PIXEL = 72 / 96;
const SIZE_SLACK_PT = 1;

type Logged = { event: string; fields: Record<string, unknown> }[];

const collect =
  (logged: Logged): Log =>
  (event, fields = {}) => {
    logged.push({ event, fields });
  };

/** Every slide of `post` rendered at portrait: the JPEG made from each PNG master, and each fit report. */
async function renderPost(post: Post): Promise<{ jpegs: Uint8Array[]; reports: FitReport[] }> {
  const renderer = createRenderer({ log: () => undefined });
  try {
    const jpegs: Uint8Array[] = [];
    const reports: FitReport[] = [];
    for (const index of post.slides.keys()) {
      const drawn = await renderPostSlide(renderer, post, 'portrait', [LOGO], index);
      jpegs.push((await toJpeg(drawn.png)).data);
      reports.push(drawn.report);
    }
    return { jpegs, reports };
  } finally {
    await renderer.close();
  }
}

/** Prints `post` with a printer whose log is collected. */
async function print(
  post: Post,
  reports: readonly FitReport[],
  title: string,
): Promise<{ pdf: Uint8Array; logged: Logged }> {
  const logged: Logged = [];
  const printer = await documentPrinter(collect(logged));
  try {
    const pdf = await printPost(printer, {
      post,
      size: 'portrait',
      reports,
      title,
      assets: [LOGO],
    });
    return { pdf, logged };
  } finally {
    await printer.close();
  }
}

// The viewer: a page of its own, at an address that exists nowhere, given pdf.js, the PDF and the JPEGs by `route`.
const VIEWER = 'https://viewer.lzp.invalid';
const PDFJS = (file: string) =>
  readFile(
    fileURLToPath(
      new URL(`../../packages/render/node_modules/pdfjs-dist/build/${file}`, import.meta.url),
    ),
  );

async function openViewer(page: Page, pdf: Uint8Array, jpegs: readonly Uint8Array[]) {
  const files = new Map<string, { body: Buffer; contentType: string }>([
    ['/', { body: Buffer.from('<!DOCTYPE html><title>viewer</title>'), contentType: 'text/html' }],
    ['/pdf.mjs', { body: await PDFJS('pdf.mjs'), contentType: 'text/javascript' }],
    ['/pdf.worker.mjs', { body: await PDFJS('pdf.worker.mjs'), contentType: 'text/javascript' }],
    ['/doc.pdf', { body: Buffer.from(pdf), contentType: 'application/pdf' }],
    ...jpegs.map((jpeg, index): [string, { body: Buffer; contentType: string }] => [
      `/slide-${String(index + 1)}.jpg`,
      { body: Buffer.from(jpeg), contentType: 'image/jpeg' },
    ]),
  ]);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const file = url.origin === VIEWER ? files.get(url.pathname) : undefined;
    if (file === undefined) await route.abort('blockedbyclient');
    else await route.fulfill({ status: 200, contentType: file.contentType, body: file.body });
  });
  await page.goto(`${VIEWER}/`);
}

type PageFacts = {
  widthPt: number;
  heightPt: number;
  text: string;
  /** The page rasterised at 96 dpi against its JPEG, over the area both cover. */
  compared: { width: number; height: number; meanChannel: number; farShare: number };
};
type PdfFacts = { pages: number; title: string | null; marked: boolean | null; each: PageFacts[] };

// Runs in the viewer: reads the PDF with pdf.js, and draws each page next to its JPEG. A string, so the page's code
// needs no DOM types here.
const INSPECT = `(async () => {
  const pdfjs = await import('/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
  const data = new Uint8Array(await (await fetch('/doc.pdf')).arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const { info } = await doc.getMetadata();
  const mark = await doc.getMarkInfo();
  const each = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [x0, y0, x1, y1] = page.view;
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str ?? '').join(' ');
    const jpeg = new Image();
    jpeg.src = '/slide-' + n + '.jpg';
    await jpeg.decode().catch(() => undefined);
    const width = jpeg.naturalWidth;
    const viewport = page.getViewport({ scale: width === 0 ? ${String(1 / POINTS_PER_PIXEL)} : width / (x1 - x0) });
    const drawn = document.createElement('canvas');
    drawn.width = Math.round(viewport.width);
    drawn.height = Math.round(viewport.height);
    const pageContext = drawn.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: pageContext, viewport, background: 'white' }).promise;
    let compared = { width: 0, height: 0, meanChannel: 255, farShare: 1 };
    if (width > 0) {
      const w = Math.min(drawn.width, width);
      const h = Math.min(drawn.height, jpeg.naturalHeight);
      const image = document.createElement('canvas');
      image.width = width;
      image.height = jpeg.naturalHeight;
      const imageContext = image.getContext('2d', { willReadFrequently: true });
      imageContext.drawImage(jpeg, 0, 0);
      const a = pageContext.getImageData(0, 0, w, h).data;
      const b = imageContext.getImageData(0, 0, w, h).data;
      let sum = 0;
      let far = 0;
      for (let i = 0; i < a.length; i += 4) {
        let worst = 0;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(a[i + c] - b[i + c]);
          sum += d;
          if (d > worst) worst = d;
        }
        if (worst > ${String(TOLERANCE.far)}) far++;
      }
      const pixels = w * h;
      compared = { width: w, height: h, meanChannel: sum / (pixels * 3), farShare: far / pixels };
    }
    each.push({ widthPt: x1 - x0, heightPt: y1 - y0, text, compared });
  }
  return { pages: doc.numPages, title: info.Title ?? null, marked: mark?.Marked ?? null, each };
})()`;

/** What pdf.js reads from `pdf`, each page compared with the JPEG at the same place in `jpegs`. */
async function inspect(
  page: Page,
  pdf: Uint8Array,
  jpegs: readonly Uint8Array[],
): Promise<PdfFacts> {
  await openViewer(page, pdf, jpegs);
  return page.evaluate<PdfFacts>(INSPECT);
}

const within = (compared: PageFacts['compared']) =>
  compared.meanChannel <= TOLERANCE.meanChannel && compared.farShare <= TOLERANCE.farShare;

/** The words of a text, as copying it out gives them. */
const words = (text: string) => text.split(/[\s.,]+/u).filter((word) => word !== '');

/**
 * The fonts the PDF uses, read from its bytes: each font descriptor and whether it carries its font file (`/FontFile`,
 * `/FontFile2` or `/FontFile3`). Chrome writes these dictionaries uncompressed.
 */
function fontDescriptors(pdf: Uint8Array): { name: string; embedded: boolean }[] {
  const text = Buffer.from(pdf).toString('latin1');
  return [
    ...text.matchAll(
      /<<(?:(?!endobj)[\s\S])*?\/Type\s*\/FontDescriptor(?:(?!endobj)[\s\S])*?endobj/g,
    ),
  ].map(([object]) => ({
    name: /\/FontName\s*\/([^\s/<>[\]()]+)/.exec(object)?.[1] ?? '',
    embedded: /\/FontFile[23]?\s/.test(object),
  }));
}

test('the PDF: one page per slide, each the image’s size, fonts embedded, titled with the hook', async ({
  page,
}) => {
  const post = carousel();
  const { jpegs, reports } = await renderPost(post);
  // The fit script lowered the long slide's `k`: the PDF has to take it from the report.
  expect(reports.map((report) => report.k < 1)).toEqual([false, true, false]);
  const { pdf, logged } = await print(post, reports, HOOK);

  expect(Buffer.from(pdf).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(logged).toEqual([]);

  const facts = await inspect(page, pdf, jpegs);
  expect(facts.pages).toBe(3);
  expect(facts.title).toBe(HOOK);
  for (const each of facts.each) {
    expect(Math.abs(each.widthPt - 1080 * POINTS_PER_PIXEL)).toBeLessThanOrEqual(SIZE_SLACK_PT);
    expect(Math.abs(each.heightPt - 1350 * POINTS_PER_PIXEL)).toBeLessThanOrEqual(SIZE_SLACK_PT);
    expect([each.widthPt, each.heightPt]).toEqual([
      facts.each[0]?.widthPt,
      facts.each[0]?.heightPt,
    ]);
  }

  const fonts = fontDescriptors(pdf);
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.filter((font) => !font.embedded)).toEqual([]);
  expect(fonts.some((font) => font.name.includes('Nunito'))).toBe(true);
  test.info().annotations.push({
    type: 'tagged',
    description: `MarkInfo /Marked: ${String(facts.marked)}`,
  });
});

test('each page matches its JPEG within the tolerance, and the English text can be copied out', async ({
  page,
}) => {
  const post = carousel();
  const { jpegs, reports } = await renderPost(post);
  const { pdf } = await print(post, reports, HOOK);
  const facts = await inspect(page, pdf, jpegs);

  expect(facts.each).toHaveLength(3);
  facts.each.forEach((each, index) => {
    test.info().annotations.push({
      type: `page ${String(index + 1)} against its JPEG`,
      description: `mean ${each.compared.meanChannel.toFixed(3)}/255 per channel, ${(each.compared.farShare * 100).toFixed(3)}% of pixels off by more than ${String(TOLERANCE.far)}`,
    });
    expect(each.compared.width).toBe(1080);
    expect(each.compared.height).toBeGreaterThanOrEqual(1349);
    expect(each.compared.meanChannel).toBeLessThanOrEqual(TOLERANCE.meanChannel);
    expect(each.compared.farShare).toBeLessThanOrEqual(TOLERANCE.farShare);
  });

  // Selectable text: every word of each slide, as pdf.js copies it out of the page.
  post.slides.forEach((slide, index) => {
    if (slide.layout !== 'text') throw new Error('a text slide');
    const copied = words(facts.each[index]?.text ?? '');
    for (const word of words(`${slide.title.replaceAll('*', '')} ${slide.body}`))
      expect(copied).toContain(word);
  });
});

test('a page printed at another k, or another slide’s page, is outside the tolerance', async ({
  page,
}) => {
  const post = carousel();
  const { jpegs, reports } = await renderPost(post);
  const atOne = reports.map((report) => ({ ...report, k: 1 }));
  const { pdf } = await print(post, atOne, HOOK);
  const facts = await inspect(page, pdf, jpegs);
  // The long slide at k 1 is not its JPEG; the others were at k 1 anyway.
  expect(
    within(facts.each[1]?.compared ?? { width: 0, height: 0, meanChannel: 255, farShare: 1 }),
  ).toBe(false);
  expect(
    within(facts.each[0]?.compared ?? { width: 0, height: 0, meanChannel: 255, farShare: 1 }),
  ).toBe(true);

  // The first page against the third slide's JPEG.
  const swapped = await inspect(page, pdf, [jpegs[2] ?? new Uint8Array()]);
  expect(
    within(swapped.each[0]?.compared ?? { width: 0, height: 0, meanChannel: 255, farShare: 1 }),
  ).toBe(false);
});

test('a Bangla PDF matches its JPEG; whether its text copies out is reported, not required', async ({
  page,
}) => {
  const post = testBanglaPost();
  const { jpegs, reports } = await renderPost(post);
  const { pdf } = await print(post, reports, 'ফিরে এল পিঠা সপ্তাহ');
  const facts = await inspect(page, pdf, jpegs);
  expect(facts.pages).toBe(1);
  expect(facts.title).toBe('ফিরে এল পিঠা সপ্তাহ');
  const [only] = facts.each;
  expect(within(only?.compared ?? { width: 0, height: 0, meanChannel: 255, farShare: 1 })).toBe(
    true,
  );
  expect(fontDescriptors(pdf).filter((font) => !font.embedded)).toEqual([]);

  // §08: Chrome's PDF can give Bangla back garbled when copied; this records what it gave.
  const copied = (only?.text ?? '').replace(/\s+/gu, ' ').trim();
  const expected = 'ফিরে এল পিঠা সপ্তাহ';
  test.info().annotations.push({
    type: 'Bangla copy-out',
    description: copied.includes(expected)
      ? `the title copies out intact: "${expected}"`
      : `the title does not copy out intact; pdf.js gave "${copied.slice(0, 200)}"`,
  });
});

test('the printer reaches no network: a remote image is blocked and logged by origin and path', async () => {
  const logged: Logged = [];
  const printer: DocumentPrinter = await documentPrinter(collect(logged));
  try {
    const pdf = await printer.printPdf({
      html: '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Leak</title></head><body><p>Hello</p><img src="https://leak.example/pixel.png?user=someone"></body></html>',
      assets: [],
      size: 'portrait',
      jobId: 'job-leak',
    });
    expect(Buffer.from(pdf).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(logged).toEqual([
      {
        event: 'render.request_blocked',
        fields: { jobId: 'job-leak', url: 'https://leak.example/pixel.png', type: 'image' },
      },
    ]);
  } finally {
    await printer.close();
  }
});

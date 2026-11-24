import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Post } from '../../packages/core/src/index.ts';
import { createRenderer, type Log } from '../../packages/render/src/browser/index.ts';
import type { FitReport } from '../../packages/render/src/fit/report.ts';
import { toJpeg } from '../../packages/render/src/output/images.ts';
import { documentPrinter, printPost } from '../render/documents.ts';
import { renderPostSlide } from '../render/slides.ts';
import { SAMPLE_BRANDS } from './brands.ts';
import { SAMPLES } from './content.ts';
import { LAUNCH_CASES, caseInput, type Lang } from './matrix.ts';

// The PDF of a sample carousel against its JPEGs (§08 Golden renders: PDF pages match the JPEGs; §12 LinkedIn carousel
// PDF): Kathgolap's carousel (cover, list, text) rendered slide by slide through `renderSlide`, each PNG master made
// into its JPEG (`toJpeg`), and the PDF printed by the output task's `renderDocument` from the same pages at each
// slide's `k`. pdf.js (pdfjs-dist) draws each page in a browser page, and each is compared with its JPEG.
//
// The viewer and the comparison are the render project's (tests/render/outputs.spec.ts), restated here without the
// parts this test doesn't need (the title, the text, the tags): that file is a spec, and a spec isn't imported.

type Carousel = { lang: Lang; look: 'clean' | 'playful' };

// English in Playful and Bangla in Clean, so both looks and both scripts go through the printer.
const CAROUSELS: readonly Carousel[] = [
  { lang: 'en', look: 'playful' },
  { lang: 'bn', look: 'clean' },
];

/** Kathgolap's carousel in `lang` and `look`, with the kit and assets its cover case renders with. */
function carousel({ lang, look }: Carousel) {
  const cover = LAUNCH_CASES.find(
    (c) => c.layout === 'cover' && c.size === 'portrait' && c.look === look && c.lang === lang,
  );
  if (cover === undefined) throw new Error(`no cover case in ${look} ${lang}`);
  const { post, kit, assets } = caseInput(cover);
  const slides = [SAMPLES.cover[lang], SAMPLES.list[lang], SAMPLES.text[lang]];
  return {
    post: { ...post, kind: 'carousel', networks: ['linkedin'], slides } satisfies Post,
    kit,
    assets,
    title: SAMPLE_BRANDS.kathgolap.name[lang],
  };
}

// The tolerance a page is held to against its JPEG, as the render project holds it: the two are drawn by different
// rasterisers (Chrome's Skia for the image, pdf.js for the page) and the JPEG has its own small loss. Over the whole
// image: the mean difference per colour channel at most 3 of 255, and at most 2% of the pixels differing by more than
// 64 in any channel. Another slide's page is far outside it (the last check holds that).
const TOLERANCE = { meanChannel: 3, farShare: 0.02, far: 64 } as const;

type Compared = { width: number; height: number; meanChannel: number; farShare: number };

const within = (compared: Compared | undefined) =>
  compared !== undefined &&
  compared.meanChannel <= TOLERANCE.meanChannel &&
  compared.farShare <= TOLERANCE.farShare;

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

// Runs in the viewer: draws each page of the PDF at its JPEG's width and compares the two. A string, so the page's
// code needs no DOM types here.
const COMPARE = `(async () => {
  const pdfjs = await import('/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
  const data = new Uint8Array(await (await fetch('/doc.pdf')).arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const each = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [x0, , x1] = page.view;
    const jpeg = new Image();
    jpeg.src = '/slide-' + n + '.jpg';
    await jpeg.decode().catch(() => undefined);
    const width = jpeg.naturalWidth;
    if (width === 0) { each.push({ width: 0, height: 0, meanChannel: 255, farShare: 1 }); continue; }
    const viewport = page.getViewport({ scale: width / (x1 - x0) });
    const drawn = document.createElement('canvas');
    drawn.width = Math.round(viewport.width);
    drawn.height = Math.round(viewport.height);
    const pageContext = drawn.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: pageContext, viewport, background: 'white' }).promise;
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
    each.push({ width: w, height: h, meanChannel: sum / (pixels * 3), farShare: far / pixels });
  }
  return { pages: doc.numPages, each };
})()`;

async function compare(
  page: Page,
  pdf: Uint8Array,
  jpegs: readonly Uint8Array[],
): Promise<{ pages: number; each: Compared[] }> {
  await openViewer(page, pdf, jpegs);
  return page.evaluate<{ pages: number; each: Compared[] }>(COMPARE);
}

for (const which of CAROUSELS) {
  test(`a sample carousel's PDF pages match its JPEGs: ${which.lang}, ${which.look}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const { post, kit, assets, title } = carousel(which);

    const jpegs: Uint8Array[] = [];
    const reports: FitReport[] = [];
    const renderer = createRenderer({ log: () => undefined });
    try {
      for (const index of post.slides.keys()) {
        const drawn = await renderPostSlide(renderer, post, 'portrait', assets, index, kit);
        jpegs.push((await toJpeg(drawn.png)).data);
        reports.push(drawn.report);
      }
    } finally {
      await renderer.close();
    }
    // Each page is printed at its slide's `k`, whatever the fit check said: what it said is noted, not required here
    // (the golden images show it).
    test.info().annotations.push({
      type: 'fit',
      description: reports.map((report) => `${report.status} at k ${String(report.k)}`).join('; '),
    });

    const logged: string[] = [];
    const log: Log = (event) => {
      logged.push(event);
    };
    const printer = await documentPrinter(log);
    let pdf: Uint8Array;
    try {
      pdf = await printPost(printer, { post, size: 'portrait', reports, title, assets, kit });
    } finally {
      await printer.close();
    }
    expect(Buffer.from(pdf).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(logged, 'the printer blocked something').toEqual([]);

    const facts = await compare(page, pdf, jpegs);
    expect(facts.pages).toBe(3);
    facts.each.forEach((each, index) => {
      test.info().annotations.push({
        type: `page ${String(index + 1)} against its JPEG`,
        description: `mean ${each.meanChannel.toFixed(3)}/255 per channel, ${(each.farShare * 100).toFixed(3)}% of pixels off by more than ${String(TOLERANCE.far)}`,
      });
      expect(each.width).toBe(1080);
      expect(each.height).toBeGreaterThanOrEqual(1349);
      expect(each.meanChannel).toBeLessThanOrEqual(TOLERANCE.meanChannel);
      expect(each.farShare).toBeLessThanOrEqual(TOLERANCE.farShare);
    });

    // The check can tell pages apart: the cover's page against the text slide's JPEG is outside the tolerance.
    const swapped = await compare(page, pdf, [jpegs[2] ?? new Uint8Array()]);
    expect(within(swapped.each[0])).toBe(false);
  });
}

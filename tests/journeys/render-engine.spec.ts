import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { SIZE_NAMES, SIZES, type Post, type Slide } from '../../packages/core/src/index.ts';
import {
  createRenderer,
  PAGE_ORIGIN,
  type Log,
  type RenderAsset,
} from '../../packages/render/src/browser/index.ts';
import type { FitReport } from '../../packages/render/src/fit/report.ts';
import type { RenderKit } from '../../packages/render/src/kit.ts';
import { toJpeg, toPng, toThumbnail } from '../../packages/render/src/output/images.ts';
import {
  RENDERER_VERSION,
  renderKey,
  type KeyAsset,
  type OutputFormat,
} from '../../packages/render/src/output/key.ts';
import { getLook } from '../../packages/render/src/page/looks.ts';
import { documentPrinter, printPost } from '../render/documents.ts';
import { renderPostSlide } from '../render/slides.ts';
import { SAMPLES } from '../golden/content.ts';
import { LAUNCH_CASES, caseInput, type Lang } from '../golden/matrix.ts';

// The Render engine feature's journey (§19 A task's life, #156; #386): a post goes in, every output comes out. The
// engine has no screens, so the route is the one a post takes through the render package's public API, end to end, in
// the real render browser: the slide pages drawn by `renderSlide` at every size, each PNG master made into the PNG, the
// JPEG and the thumbnail, the LinkedIn PDF printed from the same pages, and the cache key of every file. It also holds
// the fit route (§08 The fit check): a slide with far too much text comes back as a `fail` that names its field and a
// target, and the same post with the field shortened to the target passes; and the render's guards: a request outside
// the asset address, and a photo the job doesn't have, are blocked and reported, never dropped silently.
//
// It runs in the `journeys` project of CI's services job and needs no page of the app: it never uses `baseURL`; the
// `page` fixture only opens a viewer of its own (pdf.js, from the render package's dev dependencies) to count the PDF's
// pages. It relies on: the golden sample kit, photo and slides (tests/golden/), which the golden renders hold to
// approved images; `renderSlide`, `createRenderer`, `renderDocument` (through tests/render/documents.ts, the way the
// render specs load it), `toPng`/`toJpeg`/`toThumbnail` and `renderKey`; the sizes in `SIZES`; the thumbnail's width of
// 360 px (WebP); and the report's field path `slides[n].title` for a text slide's title. It is the route, not the matrix:
// the golden renders and tests/render/ hold the detail. It lands as the feature's last task, so it is a plain `test`
// that passes the first time (#156).

// ---------------------------------------------------------------------------------------------------------------
// The two posts: English in Clean with a photo on the cover, Bangla in Playful with no photo. A few slides each.

type Journey = {
  name: string;
  lang: Lang;
  look: 'clean' | 'playful';
  slides: Slide[];
  /** The post's hook: the PDF's title. */
  title: string;
};

const JOURNEYS: readonly Journey[] = [
  {
    name: 'an English post in the Clean look, a photo on its cover',
    lang: 'en',
    look: 'clean',
    slides: [SAMPLES.cover.en, SAMPLES.list.en, SAMPLES.text.en],
    title: 'Bring a book, stay for tea',
  },
  {
    name: 'a Bangla post in the Playful look, no photo',
    lang: 'bn',
    look: 'playful',
    slides: [SAMPLES.list.bn, SAMPLES.quote.bn, SAMPLES.text.bn],
    title: 'বইয়ের আড্ডা',
  },
];

type Material = { post: Post; kit: RenderKit; assets: RenderAsset[] };

/** The post with `slides`, and the golden sample kit (after the look's contrast check) and assets it renders with. */
function material(lang: Lang, look: Journey['look'], slides: Slide[]): Material {
  const cover = LAUNCH_CASES.find(
    (c) => c.layout === 'cover' && c.size === 'portrait' && c.look === look && c.lang === lang,
  );
  if (cover === undefined) throw new Error(`no golden cover case in ${look} ${lang}`);
  const { post, kit, assets } = caseInput(cover);
  return { post: { ...post, kind: 'carousel', networks: ['linkedin'], slides }, kit, assets };
}

// ---------------------------------------------------------------------------------------------------------------
// File signatures and sizes, read from the bytes: no image library is needed here.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Dimensions = { width: number; height: number };

function pngSize(file: Uint8Array): Dimensions {
  const bytes = Buffer.from(file);
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), 'a PNG starts with the PNG signature').toBe(
    true,
  );
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** A JPEG's size, from its first start-of-frame marker (baseline, extended or progressive). */
function jpegSize(file: Uint8Array): Dimensions {
  const bytes = Buffer.from(file);
  expect([...bytes.subarray(0, 3)], 'a JPEG starts with FF D8 FF').toEqual([0xff, 0xd8, 0xff]);
  for (let at = 2; at + 9 < bytes.length; at += 2 + bytes.readUInt16BE(at + 2)) {
    expect(bytes.readUInt8(at), 'a JPEG marker starts with FF').toBe(0xff);
    const marker = bytes.readUInt8(at + 1);
    // C0 to CF are the frame markers, except C4 (Huffman tables), C8 (reserved) and CC (arithmetic conditioning).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
  }
  throw new Error('the JPEG has no frame header');
}

/** A WebP's size, from its first chunk (lossy, extended or lossless). */
function webpSize(file: Uint8Array): Dimensions {
  const bytes = Buffer.from(file);
  expect(
    bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP',
    'a WebP starts with RIFF …… WEBP',
  ).toBe(true);
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8 ')
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  if (chunk === 'VP8X')
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`the WebP's first chunk is "${chunk}"`);
}

// ---------------------------------------------------------------------------------------------------------------
// A whole post through the engine: every slide at every size, every output of each, the PDF, and every cache key.

type Output = { key: string; bytes: Uint8Array; sizes?: Dimensions };

type Rendered = {
  /** Every file by its name: `portrait/1.png`, `story/3.webp`, `post.pdf`. */
  outputs: Map<string, Output>;
  /** The fit report of each slide at the PDF's size, in slide order. */
  reports: FitReport[];
  /** What each render browser page reported: every request it answered or blocked. */
  requests: { served: string[]; blocked: { url: string; type: string }[] }[];
};

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** The post's slides rendered, made into every output, and the PDF printed. A fresh browser each time. */
async function renderPost(journey: Journey, { post, kit, assets }: Material): Promise<Rendered> {
  const outputs = new Map<string, Output>();
  const requests: Rendered['requests'] = [];
  const reports: FitReport[] = [];
  const keyAssets: KeyAsset[] = assets.map(({ key, data }) => ({ key, sha256: sha256(data) }));
  let lookVersion: number | undefined;
  const keyOf = (
    format: Exclude<OutputFormat, 'pdf'>,
    size: (typeof SIZE_NAMES)[number],
    slide: number,
  ) => {
    // The look is registered by the time a slide has been rendered (the render specs' loader imports every look).
    lookVersion ??= getLook(post.look.name)?.version;
    if (lookVersion === undefined)
      throw new Error(`the look "${post.look.name}" is not registered`);
    return renderKey({
      rendererVersion: RENDERER_VERSION,
      lookVersion,
      kit,
      post,
      assets: keyAssets,
      size,
      format,
      slide,
    });
  };

  const renderer = createRenderer({ log: () => undefined });
  try {
    for (const size of SIZE_NAMES) {
      for (const index of post.slides.keys()) {
        const drawn = await renderPostSlide(renderer, post, size, assets, index, kit);
        requests.push({ served: drawn.render.served, blocked: drawn.render.blocked });
        if (size === 'portrait') reports.push(drawn.report);
        const name = `${size}/${String(index + 1)}`;
        const png = await toPng(drawn.png);
        const jpeg = (await toJpeg(drawn.png)).data;
        const thumbnail = await toThumbnail(drawn.png);
        outputs.set(`${name}.png`, { key: keyOf('png', size, index), bytes: png });
        outputs.set(`${name}.jpg`, { key: keyOf('jpeg', size, index), bytes: jpeg });
        outputs.set(`${name}.webp`, { key: keyOf('webp', size, index), bytes: thumbnail });
      }
    }
  } finally {
    await renderer.close();
  }

  const printer = await documentPrinter(() => undefined);
  try {
    const pdf = await printPost(printer, {
      post,
      size: 'portrait',
      reports,
      title: journey.title,
      assets,
      kit,
    });
    lookVersion ??= getLook(post.look.name)?.version;
    if (lookVersion === undefined)
      throw new Error(`the look "${post.look.name}" is not registered`);
    outputs.set('post.pdf', {
      key: renderKey({
        rendererVersion: RENDERER_VERSION,
        lookVersion,
        kit,
        post,
        assets: keyAssets,
        size: 'portrait',
        format: 'pdf',
        title: journey.title,
      }),
      bytes: pdf,
    });
  } finally {
    await printer.close();
  }
  return { outputs, reports, requests };
}

/**
 * A PDF's bytes without what Chrome stamps on every file: the creation and modification dates and the document id. The
 * rest, the pages and their content, is what two renders of one post must share.
 */
function withoutStamps(pdf: Uint8Array): string {
  return Buffer.from(pdf)
    .toString('latin1')
    .replace(/\/(CreationDate|ModDate)\s*\([^)]*\)/g, '/$1 ()')
    .replace(/\/ID\s*\[[^\]]*\]/g, '/ID []');
}

/** Where two texts first differ, with a little around it, for a failure that says what changed. */
function firstDifference(a: string, b: string): string {
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  return `at ${String(at)}: …${JSON.stringify(a.slice(Math.max(0, at - 30), at + 30))} against …${JSON.stringify(b.slice(Math.max(0, at - 30), at + 30))}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The PDF's pages, read back by pdf.js in a viewer page of its own, at an address that exists nowhere.

const VIEWER = 'https://viewer.lzp.invalid';
const PDFJS = (file: string) =>
  readFile(
    fileURLToPath(
      new URL(`../../packages/render/node_modules/pdfjs-dist/build/${file}`, import.meta.url),
    ),
  );

type PdfPages = { pages: number; each: { widthPt: number; heightPt: number }[] };

// Runs in the viewer. A string, so this file needs no DOM types.
const PAGES = `(async () => {
  const pdfjs = await import('/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
  const data = new Uint8Array(await (await fetch('/doc.pdf')).arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const each = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const [x0, y0, x1, y1] = (await doc.getPage(n)).view;
    each.push({ widthPt: x1 - x0, heightPt: y1 - y0 });
  }
  return { pages: doc.numPages, each };
})()`;

async function pdfPages(page: Page, pdf: Uint8Array): Promise<PdfPages> {
  const files = new Map<string, { body: Buffer; contentType: string }>([
    ['/', { body: Buffer.from('<!DOCTYPE html><title>viewer</title>'), contentType: 'text/html' }],
    ['/pdf.mjs', { body: await PDFJS('pdf.mjs'), contentType: 'text/javascript' }],
    ['/pdf.worker.mjs', { body: await PDFJS('pdf.worker.mjs'), contentType: 'text/javascript' }],
    ['/doc.pdf', { body: Buffer.from(pdf), contentType: 'application/pdf' }],
  ]);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const file = url.origin === VIEWER ? files.get(url.pathname) : undefined;
    if (file === undefined) await route.abort('blockedbyclient');
    else await route.fulfill({ status: 200, contentType: file.contentType, body: file.body });
  });
  await page.goto(`${VIEWER}/`);
  return page.evaluate<PdfPages>(PAGES);
}

// A PDF page is in points, the image in CSS pixels: 72 points to 96 pixels. Chrome may round a page's size, so a page
// is held to its image's size within a point.
const POINTS_PER_PIXEL = 72 / 96;
const SIZE_SLACK_PT = 1;

// ---------------------------------------------------------------------------------------------------------------
// Journey 1 and 2: a post goes in, every output comes out, and a second render gives the same key and the same bytes.

for (const journey of JOURNEYS) {
  test(`${journey.name}: every output comes out, and a second render is the same`, async ({
    page,
  }) => {
    // Two full renders of a post: 5 sizes × 3 slides each, and a PDF each.
    test.setTimeout(300_000);
    const input = material(journey.lang, journey.look, journey.slides);
    const first = await renderPost(journey, input);
    const slides = journey.slides.length;

    // Every slide at every size comes out as a PNG, a JPEG and a thumbnail, each with its signature and size.
    expect(first.outputs.size, 'the files: 5 sizes × slides × 3 formats, and the PDF').toBe(
      SIZE_NAMES.length * slides * 3 + 1,
    );
    for (const size of SIZE_NAMES) {
      const { width, height } = SIZES[size];
      for (let slide = 1; slide <= slides; slide++) {
        const name = `${size}/${String(slide)}`;
        const get = (extension: string) => {
          const output = first.outputs.get(`${name}.${extension}`);
          if (output === undefined) throw new Error(`no ${name}.${extension}`);
          return output.bytes;
        };
        expect(pngSize(get('png')), `${name} as a PNG`).toEqual({ width, height });
        expect(jpegSize(get('jpg')), `${name} as a JPEG`).toEqual({ width, height });
        const thumbnail = webpSize(get('webp'));
        expect(thumbnail.width, `${name}'s thumbnail width`).toBe(360);
        expect(
          Math.abs(thumbnail.height - (360 * height) / width),
          `${name}'s thumbnail keeps the slide's proportions`,
        ).toBeLessThanOrEqual(1);
      }
    }

    // The LinkedIn PDF: the file signature, and one page per slide at the portrait size.
    const pdf = first.outputs.get('post.pdf');
    if (pdf === undefined) throw new Error('no PDF');
    expect(Buffer.from(pdf.bytes).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const read = await pdfPages(page, pdf.bytes);
    expect(read.pages, 'one PDF page per slide').toBe(slides);
    for (const each of read.each) {
      expect(Math.abs(each.widthPt - SIZES.portrait.width * POINTS_PER_PIXEL)).toBeLessThanOrEqual(
        SIZE_SLACK_PT,
      );
      expect(
        Math.abs(each.heightPt - SIZES.portrait.height * POINTS_PER_PIXEL),
      ).toBeLessThanOrEqual(SIZE_SLACK_PT);
    }

    // Each file has a key of its own, and the page asked for nothing outside the asset address while it drew.
    expect(new Set([...first.outputs.values()].map((output) => output.key)).size).toBe(
      first.outputs.size,
    );
    expect(
      first.requests.flatMap((request) => request.blocked),
      'blocked requests',
    ).toEqual([]);
    const photo = first.requests.some((request) => request.served.includes('image/photo_1'));
    expect(photo, 'the photo was served to the page at its asset address').toBe(
      journey.slides.some((slide) => 'image' in slide),
    );

    // A second render of the same post, in a browser of its own: the same keys and the same bytes.
    const second = await renderPost(journey, input);
    expect([...second.outputs.keys()]).toEqual([...first.outputs.keys()]);
    for (const [name, output] of first.outputs) {
      const again = second.outputs.get(name);
      if (again === undefined) throw new Error(`no ${name} in the second render`);
      expect(again.key, `${name}'s cache key`).toBe(output.key);
      if (name.endsWith('.pdf')) {
        const [a, b] = [withoutStamps(output.bytes), withoutStamps(again.bytes)];
        expect(a === b, `the PDF's bytes, but for Chrome's stamps: ${firstDifference(a, b)}`).toBe(
          true,
        );
      } else {
        expect(Buffer.from(again.bytes).equals(Buffer.from(output.bytes)), `${name}'s bytes`).toBe(
          true,
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Journey 3: the fit route (§08 The fit check). A title far too long fails and names its field with a shorter target;
// the same post with the title shortened to the target passes.

/** A title far too long for any size: the same sentence, eight times. */
const LONG_TITLE = Array.from(
  { length: 8 },
  () => 'Pitha is older than tea and so is the rice cake itself',
).join(' ');

const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
const graphemes = (text: string) => Array.from(segmenter.segment(text)).length;

/** `text` cut after the last whole word that keeps it within `target` graphemes (one word at least). */
function shortenTo(text: string, target: number): string {
  const words = text.split(' ');
  let kept = words.slice(0, 1);
  for (const word of words.slice(1)) {
    if (graphemes([...kept, word].join(' ')) > target) break;
    kept = [...kept, word];
  }
  return kept.join(' ');
}

test('a slide with far too much text is a fit failure naming the field; shortened to its target, it passes', async () => {
  test.setTimeout(90_000);
  const withTitle = (title: string): Material =>
    material('en', 'clean', [
      SAMPLES.cover.en,
      { ...SAMPLES.text.en, title, body: 'Three things, one winter.' },
      SAMPLES.list.en,
    ]);
  const renderer = createRenderer({ log: () => undefined });
  try {
    const long = withTitle(LONG_TITLE);
    const before = await renderPostSlide(renderer, long.post, 'portrait', long.assets, 1, long.kit);
    expect(before.report).toMatchObject({ size: 'portrait', slide: 2, k: 0.85, status: 'fail' });
    const field = before.report.fields.find((each) => each.field === 'slides[1].title');
    expect(field, 'the report names the title of the long slide').toBeDefined();
    expect(field?.graphemes).toBe(graphemes(LONG_TITLE));
    expect(field?.overflowPx).toBeGreaterThan(0);
    const target = field?.targetGraphemes ?? 0;
    expect(target).toBeGreaterThan(0);
    expect(target, 'a target shorter than the text').toBeLessThan(graphemes(LONG_TITLE));

    // The fit fix's route: the field shortened to the target, the same post rendered again.
    const shortened = shortenTo(LONG_TITLE, target);
    expect(graphemes(shortened)).toBeLessThanOrEqual(target);
    const fixed = withTitle(shortened);
    const after = await renderPostSlide(
      renderer,
      fixed.post,
      'portrait',
      fixed.assets,
      1,
      fixed.kit,
    );
    expect(after.report, 'the shortened post fits').toMatchObject({ status: 'pass', fields: [] });
    expect(after.report.k).toBeGreaterThanOrEqual(0.85);
  } finally {
    await renderer.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Journey 4: the render's guards, through the same public path. The page gets no network: what it asks for outside
// the asset address is blocked and reported; a photo the job doesn't have is a reported failure, not a blank box.

type Logged = { event: string; fields: Record<string, unknown> }[];

const collect =
  (logged: Logged): Log =>
  (event, fields = {}) => {
    logged.push({ event, fields });
  };

test('a request outside the asset address is blocked and reported; a missing photo is a reported failure', async () => {
  test.setTimeout(90_000);
  const logged: Logged = [];
  const renderer = createRenderer({ log: collect(logged) });
  try {
    // A page that asks for an image from the internet: the request is blocked and named, without its query string.
    const leak = await renderer.renderPage({
      html: '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Leak</title></head><body><p>Hello</p><img src="https://leak.example/pixel.png?user=someone"></body></html>',
      assets: [],
      size: 'portrait',
      jobId: 'job-leak',
    });
    expect(leak.blocked).toEqual([{ url: 'https://leak.example/pixel.png', type: 'image' }]);
    expect(logged).toEqual([
      {
        event: 'render.request_blocked',
        fields: { jobId: 'job-leak', url: 'https://leak.example/pixel.png', type: 'image' },
      },
    ]);

    // A cover whose photo is not among the job's assets: its request is blocked and reported, so the render is known to
    // have a hole where the photo should be. The same cover with its photo blocks nothing.
    logged.length = 0;
    const { post, kit, assets } = material('en', 'clean', [SAMPLES.cover.en]);
    const present = await renderPostSlide(renderer, post, 'portrait', assets, 0, kit);
    expect(present.render.blocked).toEqual([]);
    expect(present.render.served).toContain('image/photo_1');
    expect(logged).toEqual([]);

    const missing: Post = {
      ...post,
      slides: [{ ...SAMPLES.cover.en, image: { asset: 'photo_missing' } }],
    };
    const drawn = await renderPostSlide(renderer, missing, 'portrait', assets, 0, kit);
    const address = `${PAGE_ORIGIN}/image/photo_missing`;
    expect(drawn.render.blocked.map((request) => request.url)).toEqual([address]);
    expect(drawn.render.served).not.toContain('image/photo_missing');
    expect(logged.map(({ event, fields }) => [event, fields.url])).toEqual([
      ['render.request_blocked', address],
    ]);
  } finally {
    await renderer.close();
  }
});

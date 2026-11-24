import { writeFile } from 'node:fs/promises';
import { chromium, expect, test, type Browser } from '@playwright/test';
import type { Post, SizeName } from '../../packages/core/src/index.ts';
import { createRenderer, type RenderAsset } from '../../packages/render/src/browser/index.ts';
import { contextOptions, LAUNCH_OPTIONS } from '../../packages/render/src/browser/flags.ts';
import { FONT_MANIFEST } from '../../packages/render/src/fonts/library.ts';
import type { RenderKit } from '../../packages/render/src/kit.ts';
import { playfulTints } from '../../packages/render/src/looks/playful/contrast.ts';
import type { Switches } from '../../packages/render/src/page/switches.ts';
import { SAMPLE_COVER } from '../../packages/render/src/layouts/samples.ts';
import { testBanglaPost, testKit, testPost } from '../../packages/render/src/page/test-fixtures.ts';
import { SIZE_NAMES, SIZES } from '../../packages/render/src/sizes.ts';
import { brandAssets } from '../golden/assets.ts';
import { renderPostSlide, slidePage, type RenderedSlide } from './slides.ts';

// The Playful look in a real Chromium (#336; §07 The four looks, §08 Looks in the renderer and The fit check). These
// run in CI's services job, the `render` Playwright project: a `text` slide in the Playful look at every size, in
// English and Bangla, through the page runner and the fit script; the look's colours, stickers and print frame as
// Chrome computes them. Each drawn slide is kept as `playful-<lang>-<size>.png` in the test's output folder, which CI
// uploads as the `render-output` artifact for Iris's review.

const fonts = FONT_MANIFEST.looks.playful;
if (fonts === undefined) throw new Error('no Playful fonts in the manifest');

/** A sample kit of our own ("Sunny Lane Play Café": made-up colours, no real brand), in Playful's own font pair. */
const KIT: RenderKit = testKit({
  colors: {
    primary: '#7a2e8e',
    accent: '#ffc845',
    background: '#fff4e0',
    ink: '#2b1d3a',
    extras: [],
  },
  fonts,
});

const LOGO: RenderAsset = {
  kind: 'image',
  key: 'logo_light_1',
  contentType: 'image/png',
  data: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
};

/**
 * The sample photo: the golden renders' placeholder picture (a sky, a sun and two hills, 1600 × 1200, drawn in code),
 * kept under the key the sample cover names, so it is a real picture and not a bare fill.
 */
const PHOTO: RenderAsset = (() => {
  const photo = brandAssets('kathgolap').find((asset) => asset.key === 'photo_1');
  if (photo === undefined) throw new Error('no placeholder photo in the golden assets');
  return { ...photo, key: 'photo_sample_1' };
})();

/** The sizes the two states below are drawn at (#378). */
const STATE_SIZES = ['portrait', 'square', 'story'] as const satisfies readonly SizeName[];

/** The test post in the Playful look, in `lang`, with two slides so the page number is drawn too. */
function playfulPost(lang: 'en' | 'bn', switches: Partial<Switches> = {}): Post {
  const post = lang === 'en' ? testPost() : testBanglaPost();
  const look = { name: 'playful' as const, switches };
  return { ...post, look, slides: [...post.slides, ...post.slides] };
}

test.describe('a text slide in the Playful look fits', () => {
  for (const lang of ['en', 'bn'] as const)
    for (const size of SIZE_NAMES)
      test(`${lang}, ${size}: drawn, in the manifest's fonts, and passes the fit check`, async () => {
        const renderer = createRenderer({ log: () => undefined });
        try {
          const drawn = await renderPostSlide(renderer, playfulPost(lang), size, [LOGO], 0, KIT);
          expect(drawn.report).toMatchObject({ size, slide: 1, status: 'pass', fields: [] });
          expect(drawn.render.errors).toEqual([]); // no font fell back
          expect(drawn.render.blocked).toEqual([]);
          const families = new Set(
            drawn.render.fonts.flatMap((block) => block.fonts.map((used) => used.family)),
          );
          // English: Bagel Fat One for the kicker and title, Baloo 2 for the rest. Bangla: Baloo Da 2 for all of it.
          expect([...families].sort()).toEqual(
            lang === 'en' ? ['Bagel Fat One', 'Baloo 2'] : ['Baloo Da 2'],
          );
          await writeFile(test.info().outputPath(`playful-${lang}-${size}.png`), drawn.png);
        } finally {
          await renderer.close();
        }
      });
});

/** A cover with a real photo in the Playful look, in `lang`, twice so the page number is drawn too. */
function playfulCoverPost(lang: 'en' | 'bn', switches: Partial<Switches> = {}): Post {
  const post = lang === 'en' ? testPost() : testBanglaPost();
  const slide = SAMPLE_COVER[lang];
  return { ...post, look: { name: 'playful', switches }, slides: [slide, slide] };
}

/**
 * Draws the post's first slide as the renderer does and runs `script` in that same page, just before its screenshot, so
 * what it reads is what the PNG shows. The renderer's browser is the real one, its `newContext` watched for the page.
 */
async function drawAndRead(
  post: Post,
  size: SizeName,
  assets: readonly RenderAsset[],
  script: string,
): Promise<{ drawn: RenderedSlide; read: unknown }> {
  let read: unknown;
  const renderer = createRenderer({
    log: () => undefined,
    launch: async () => {
      const real = await chromium.launch(LAUNCH_OPTIONS);
      const open = real.newContext.bind(real);
      real.newContext = async (options) => {
        const context = await open(options);
        context.on('page', (page) => {
          const shoot = page.screenshot.bind(page);
          page.screenshot = async (shot) => {
            read = await page.evaluate<unknown>(script);
            return shoot(shot);
          };
        });
        return context;
      };
      return real;
    },
  });
  try {
    const drawn = await renderPostSlide(renderer, post, size, assets, 0, KIT);
    if (read === undefined) throw new Error('the page was never read');
    return { drawn, read };
  } finally {
    await renderer.close();
  }
}

/** What the page's two stickers draw: a pseudo-element's `content` is `none` when it is off. */
const STICKERS = `(() => {
  const slide = document.querySelector('.slide');
  return {
    before: getComputedStyle(slide, '::before').content,
    after: getComputedStyle(slide, '::after').content,
  };
})()`;

type FrameState = {
  tilt: number;
  photos: number;
  loaded: boolean;
  photoWidth: number;
  photoHeight: number;
  inPage: boolean;
};

/** The print frame: its turn, the pictures inside it, and where the first one is drawn, from the page Chrome shows. */
const FRAME = `(() => {
  const box = document.querySelector('.image-box');
  const photos = box === null ? [] : [...box.querySelectorAll('img')];
  const transform = box === null ? 'none' : getComputedStyle(box).transform;
  const m = new DOMMatrix(transform === 'none' ? undefined : transform);
  const [first] = photos;
  const at = first === undefined ? undefined : first.getBoundingClientRect();
  return {
    tilt: (Math.atan2(m.b, m.a) * 180) / Math.PI,
    photos: photos.length,
    loaded: first !== undefined && first.complete && first.naturalWidth > 0,
    photoWidth: at === undefined ? 0 : at.width,
    photoHeight: at === undefined ? 0 : at.height,
    inPage: at !== undefined && at.left >= 0 && at.top >= 0 && at.right <= innerWidth && at.bottom <= innerHeight,
  };
})()`;

test.describe('Playful with decorations off still fits, and is drawn without its stickers', () => {
  // The look's third state (#378, Iris F3): the badge and the tag are off, so the slide is the text and its page alone.
  // The stickers are read from the page the PNG is taken from.
  for (const lang of ['en', 'bn'] as const)
    for (const size of STATE_SIZES)
      test(`${lang}, ${size}: passes the fit check and draws no sticker`, async () => {
        const post = playfulPost(lang, { decorations: false });
        const { drawn, read } = await drawAndRead(post, size, [LOGO], STICKERS);
        expect(drawn.report).toMatchObject({ size, slide: 1, status: 'pass', fields: [] });
        expect(drawn.render.errors).toEqual([]);
        expect(drawn.render.blocked).toEqual([]);
        expect(read).toEqual({ before: 'none', after: 'none' });
        await writeFile(
          test.info().outputPath(`playful-decorations-off-${lang}-${size}.png`),
          drawn.png,
        );
      });
});

test.describe('Playful with the print frame and a real photo', () => {
  // The tilted print frame holds the cover's photo (#378, Iris F3): the photo is served and drawn inside the frame, and
  // the frame is turned, at every size the stacked layouts use. The frame is read from the page the PNG is taken from.
  for (const lang of ['en', 'bn'] as const)
    for (const size of STATE_SIZES)
      test(`${lang}, ${size}: the photo is in a tilted frame and the slide passes the fit check`, async () => {
        const post = playfulCoverPost(lang, { frame: 'print' });
        const { drawn, read } = await drawAndRead(post, size, [LOGO, PHOTO], FRAME);
        const frame = read as FrameState; // what the FRAME script returns
        expect(drawn.report).toMatchObject({ size, slide: 1, status: 'pass', fields: [] });
        expect(drawn.render.errors).toEqual([]);
        expect(drawn.render.blocked).toEqual([]);
        expect(drawn.render.served).toContain('image/photo_sample_1'); // the photo was loaded into the page
        expect(frame.photos).toBe(1); // inside the frame's box
        expect(frame.loaded).toBe(true); // a decoded picture, not a broken image
        expect(Math.abs(frame.tilt)).toBeGreaterThanOrEqual(2);
        expect(Math.abs(frame.tilt)).toBeLessThanOrEqual(6);
        expect(frame.photoWidth).toBeGreaterThan(200); // a real size, within the page
        expect(frame.photoHeight).toBeGreaterThan(200);
        expect(frame.inPage).toBe(true);
        await writeFile(
          test.info().outputPath(`playful-print-frame-${lang}-${size}.png`),
          drawn.png,
        );
      });
});

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch(LAUNCH_OPTIONS);
});

test.afterAll(async () => {
  await browser.close();
});

type StickerBox = { left: number; top: number; right: number; bottom: number; tilt: number };

type Computed = {
  ground: string;
  title: string;
  kicker: string;
  mark: { background: string; colour: string };
  stickers: { before: StickerBox | null; after: StickerBox | null; badge: string };
  print: number;
};

/**
 * What Chrome computes for a Playful page: the ground, the title, kicker and highlight colours, each sticker's box on
 * the page (turned about its centre, as Chrome draws it) and the turn of a print frame. No fonts are needed for this.
 */
async function computed(
  lang: 'en' | 'bn',
  size: SizeName,
  switches: Partial<Switches> = {},
): Promise<Computed> {
  const context = await browser.newContext(contextOptions(size));
  try {
    const page = await context.newPage();
    await page.setContent(await slidePage(playfulPost(lang, switches), size, 0, KIT));
    return await page.evaluate<Computed>(`(() => {
      const style = (selector, pseudo) => getComputedStyle(document.querySelector(selector), pseudo);
      const angle = (transform) => {
        const m = new DOMMatrix(transform === 'none' ? undefined : transform);
        return (Math.atan2(m.b, m.a) * 180) / Math.PI;
      };
      const sticker = (pseudo) => {
        const s = style('.slide', pseudo);
        if (s.content === 'none') return null;
        const [left, top, width, height] = [s.left, s.top, s.width, s.height].map(parseFloat);
        const m = new DOMMatrix(s.transform === 'none' ? undefined : s.transform);
        const cx = left + width / 2;
        const cy = top + height / 2;
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
          const [dx, dy] = [(x * width) / 2, (y * height) / 2];
          return [cx + m.a * dx + m.c * dy, cy + m.b * dx + m.d * dy];
        });
        const xs = corners.map(([x]) => x);
        const ys = corners.map(([, y]) => y);
        return {
          left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys),
          tilt: angle(s.transform),
        };
      };
      const frame = document.createElement('div');
      frame.className = 'image-box';
      document.querySelector('.text-area').append(frame);
      const mark = style('mark.hl');
      return {
        ground: getComputedStyle(document.body).backgroundColor,
        title: style('.title').color,
        kicker: style('.kicker').color,
        mark: { background: mark.backgroundColor, colour: mark.color },
        stickers: {
          before: sticker('::before'),
          after: sticker('::after'),
          badge: style('.slide', '::before').backgroundColor,
        },
        print: angle(getComputedStyle(frame).transform),
      };
    })()`);
  } finally {
    await context.close();
  }
}

/** A computed colour (`rgb(…)` or `color(srgb …)`) as its three 0–255 channels. */
function channels(colour: string): number[] {
  const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(colour);
  if (srgb !== null) return srgb.slice(1, 4).map((v) => Number(v) * 255);
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(colour);
  if (rgb !== null) return rgb.slice(1, 4).map(Number);
  throw new Error(`not a colour: ${colour}`);
}

const hexChannels = (hex: string): number[] =>
  [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

/** Within one step of an 8-bit channel: the browser rounds its mix at paint. */
function expectColour(colour: string, hex: string): void {
  const [got, want] = [channels(colour), hexChannels(hex)];
  for (const [i, value] of want.entries())
    expect(Math.abs((got[i] ?? -99) - value)).toBeLessThanOrEqual(1);
}

test.describe('the Playful look as Chrome draws it', () => {
  test('the ground is the background, the kicker is in the primary, and the highlight is an ink-on-accent pill', async () => {
    const page = await computed('en', 'portrait');
    expectColour(page.ground, KIT.colors.background);
    expectColour(page.title, KIT.colors.ink);
    expectColour(page.kicker, KIT.colors.primary);
    expectColour(page.mark.background, KIT.colors.accent);
    expectColour(page.mark.colour, KIT.colors.ink);
    expectColour(page.stickers.badge, playfulTints(KIT).badge);
  });

  test('a print photo frame is turned a few degrees, and a rounded one is not', async () => {
    const print = await computed('en', 'portrait', { frame: 'print' });
    expect(Math.abs(print.print)).toBeGreaterThanOrEqual(2);
    expect(Math.abs(print.print)).toBeLessThanOrEqual(6);
    const rounded = await computed('en', 'portrait', { frame: 'rounded' });
    expect(rounded.print).toBeCloseTo(0, 6);
  });

  test('decorations off leaves no sticker', async () => {
    const { stickers } = await computed('en', 'portrait', { decorations: false });
    expect(stickers.before).toBeNull();
    expect(stickers.after).toBeNull();
  });

  for (const size of SIZE_NAMES)
    for (const logo of ['bottom-left', 'bottom-right', 'top'] as const)
      test(`${size}, logo ${logo}: both stickers are drawn inside the safe zones, the tag tilted`, async () => {
        const { stickers } = await computed('bn', size, { logo });
        const { width, height, safeZones } = SIZES[size];
        const subpixel = 0.5;
        for (const box of [stickers.before, stickers.after]) {
          expect(box).not.toBeNull();
          if (box === null) continue;
          expect(box.left).toBeGreaterThanOrEqual(safeZones.left - subpixel);
          expect(box.top).toBeGreaterThanOrEqual(safeZones.top - subpixel);
          expect(box.right).toBeLessThanOrEqual(width - safeZones.right + subpixel);
          expect(box.bottom).toBeLessThanOrEqual(height - safeZones.bottom + subpixel);
        }
        expect(Math.abs(stickers.after?.tilt ?? 0)).toBeGreaterThanOrEqual(5);
      });
});

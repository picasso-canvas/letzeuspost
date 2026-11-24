import { writeFile } from 'node:fs/promises';
import { chromium, expect, test, type Browser } from '@playwright/test';
import type { Post, SizeName } from '../../packages/core/src/index.ts';
import { createRenderer, type RenderAsset } from '../../packages/render/src/browser/index.ts';
import { contextOptions, LAUNCH_OPTIONS } from '../../packages/render/src/browser/flags.ts';
import { FONT_MANIFEST } from '../../packages/render/src/fonts/library.ts';
import type { RenderKit } from '../../packages/render/src/kit.ts';
import { playfulTints } from '../../packages/render/src/looks/playful/contrast.ts';
import type { Switches } from '../../packages/render/src/page/switches.ts';
import { testBanglaPost, testKit, testPost } from '../../packages/render/src/page/test-fixtures.ts';
import { SIZE_NAMES, SIZES } from '../../packages/render/src/sizes.ts';
import { renderPostSlide, slidePage } from './slides.ts';

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

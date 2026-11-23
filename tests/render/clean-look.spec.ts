import { chromium, expect, test, type Browser } from '@playwright/test';
import type { Post, SizeName } from '../../packages/core/src/index.ts';
import { createRenderer, type RenderAsset } from '../../packages/render/src/browser/index.ts';
import { contextOptions, LAUNCH_OPTIONS } from '../../packages/render/src/browser/flags.ts';
import { FONT_MANIFEST } from '../../packages/render/src/fonts/library.ts';
import type { RenderKit } from '../../packages/render/src/kit.ts';
import { cleanTints } from '../../packages/render/src/looks/clean/contrast.ts';
import { testBanglaPost, testKit, testPost } from '../../packages/render/src/page/test-fixtures.ts';
import { SIZE_NAMES } from '../../packages/render/src/sizes.ts';
import { renderPostSlide, slidePage } from './slides.ts';

// The Clean look in a real Chromium (#335; §07 The four looks, §08 Looks in the renderer and The fit check). These run
// in CI's services job, the `render` Playwright project: a `text` slide in the Clean look at every size, in English
// and Bangla, through the page runner and the fit script, and the look's colours and Bangla rules as Chrome computes
// them.

const fonts = FONT_MANIFEST.looks.clean;
if (fonts === undefined) throw new Error('no Clean fonts in the manifest');

/** A sample kit of our own ("Stillwater Physio": made-up colours, no real brand), in Clean's own font pair. */
const KIT: RenderKit = testKit({
  colors: {
    primary: '#1e6b74',
    accent: '#f2a65a',
    background: '#ffffff',
    ink: '#1d2b36',
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

/** The test post in the Clean look, in `lang`, with two slides so the page number is drawn too. */
function cleanPost(lang: 'en' | 'bn'): Post {
  const post = lang === 'en' ? testPost() : testBanglaPost();
  const look = { name: 'clean' as const, switches: {} };
  return { ...post, look, slides: [...post.slides, ...post.slides] };
}

test.describe('a text slide in the Clean look fits', () => {
  for (const lang of ['en', 'bn'] as const)
    for (const size of SIZE_NAMES)
      test(`${lang}, ${size}: drawn, in the manifest's fonts, and passes the fit check`, async () => {
        const renderer = createRenderer({ log: () => undefined });
        try {
          const drawn = await renderPostSlide(renderer, cleanPost(lang), size, [LOGO], 0, KIT);
          expect(drawn.report).toMatchObject({ size, slide: 1, status: 'pass', fields: [] });
          expect(drawn.render.errors).toEqual([]); // no font fell back
          expect(drawn.render.blocked).toEqual([]);
          const families = new Set(
            drawn.render.fonts.flatMap((block) => block.fonts.map((used) => used.family)),
          );
          expect([...families]).toEqual(lang === 'en' ? ['Nunito'] : ['Hind Siliguri']);
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

type Computed = {
  ground: string;
  title: { lineHeight: number; fontSize: number; wrap: string; colour: string };
  body: { lineHeight: number; fontSize: number };
  kicker: string;
  mark: { line: string; colour: string; decoration: string };
};

/** What Chrome computes for the Clean page's ground, title, body, kicker and highlight. No fonts are needed for this. */
async function computed(lang: 'en' | 'bn', size: SizeName): Promise<Computed> {
  const context = await browser.newContext(contextOptions(size));
  try {
    const page = await context.newPage();
    await page.setContent(await slidePage(cleanPost(lang), size, 0, KIT));
    return await page.evaluate<Computed>(`(() => {
      const style = (selector) => getComputedStyle(document.querySelector(selector));
      const title = style('.title');
      const body = style('.body');
      const mark = style('mark.hl');
      return {
        ground: getComputedStyle(document.body).backgroundColor,
        title: {
          lineHeight: parseFloat(title.lineHeight),
          fontSize: parseFloat(title.fontSize),
          wrap: title.getPropertyValue('text-wrap-style') || title.getPropertyValue('text-wrap'),
          colour: title.color,
        },
        body: { lineHeight: parseFloat(body.lineHeight), fontSize: parseFloat(body.fontSize) },
        kicker: style('.kicker').color,
        mark: { line: mark.textDecorationLine, colour: mark.color, decoration: mark.textDecorationColor },
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

test.describe('the Clean look as Chrome draws it', () => {
  test('the ground is the tint the contrast check judges, and the kicker and highlight are in the primary', async () => {
    const page = await computed('en', 'portrait');
    expectColour(page.ground, cleanTints(KIT).ground);
    expectColour(page.title.colour, KIT.colors.ink);
    expectColour(page.kicker, KIT.colors.primary);
    expect(page.mark.line).toBe('underline');
    expectColour(page.mark.colour, KIT.colors.primary);
    expectColour(page.mark.decoration, KIT.colors.primary);
  });

  for (const size of SIZE_NAMES)
    test(`bn, ${size}: keeps the manifest's Bangla line-heights, and the title stays balanced`, async () => {
      const hind = FONT_MANIFEST.fonts.find((font) => font.family === 'Hind Siliguri');
      const page = await computed('bn', size);
      expect(page.title.lineHeight / page.title.fontSize).toBeGreaterThanOrEqual(
        (hind?.banglaLineHeight?.heading ?? 99) - 0.001,
      );
      expect(page.body.lineHeight / page.body.fontSize).toBeGreaterThanOrEqual(
        (hind?.banglaLineHeight?.body ?? 99) - 0.001,
      );
      expect(page.title.wrap).toContain('balance');
    });
});

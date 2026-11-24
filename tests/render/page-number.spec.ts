import { expect, test } from '@playwright/test';
import type { Post } from '../../packages/core/src/index.ts';
import { createRenderer, type RenderAsset } from '../../packages/render/src/browser/index.ts';
import { FONT_MANIFEST } from '../../packages/render/src/fonts/library.ts';
import { testBanglaPost, testKit } from '../../packages/render/src/page/test-fixtures.ts';
import { renderPostSlide } from './slides.ts';

// The Bangla page number in the Clean and the Playful look (#378, Iris F5): "১/২" is drawn in the Bangla digits (§07),
// and in each look's own Bangla body font, as Chrome reports the font that drew its glyphs. The two looks pair
// different Bangla fonts (manifest: Clean's Hind Siliguri, Playful's Baloo Da 2), and the page number takes the body
// font of its look, so the two do not draw it in the same font; each draws it in a Bengali font that has the digits,
// with no fallback. Runs in CI's services job, the `render` Playwright project.

const LOGO: RenderAsset = {
  kind: 'image',
  key: 'logo_light_1',
  contentType: 'image/png',
  data: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
};

const LOOKS = [
  ['clean', 'Hind Siliguri'],
  ['playful', 'Baloo Da 2'],
] as const;

for (const [look, family] of LOOKS)
  test(`${look}: the Bangla page number is Bengali digits in the look's own Bangla font`, async () => {
    const fonts = FONT_MANIFEST.looks[look];
    if (fonts === undefined) throw new Error(`no ${look} fonts in the manifest`);
    expect(fonts.bn.body).toBe(family);

    const base = testBanglaPost();
    const post: Post = {
      ...base,
      look: { name: look, switches: {} },
      slides: [...base.slides, ...base.slides],
    };
    const renderer = createRenderer({ log: () => undefined });
    try {
      const drawn = await renderPostSlide(
        renderer,
        post,
        'portrait',
        [LOGO],
        0,
        testKit({ fonts }),
      );
      expect(drawn.render.errors).toEqual([]); // no font fell back
      const [number, ...more] = drawn.render.fonts.filter((block) =>
        block.block.endsWith('.page-number'),
      );
      expect(more).toEqual([]); // one page number
      expect(number?.fonts.map((used) => used.family)).toEqual([family]);
      expect(number?.fonts.every((used) => used.custom && used.glyphs > 0)).toBe(true);
    } finally {
      await renderer.close();
    }
  });

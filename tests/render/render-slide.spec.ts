import { expect, test } from '@playwright/test';
import { createRenderer, type RenderAsset } from '../../packages/render/src/browser/index.ts';
import { FitReportSchema } from '../../packages/render/src/fit/report.ts';
import { testPost, testSlide } from '../../packages/render/src/page/test-fixtures.ts';
import { SIZE_NAMES, SIZES } from '../../packages/render/src/sizes.ts';
import { orderOf, renderPostSlide } from './slides.ts';

// `renderSlide` joined to the page runner in a real Chromium (§08 The fit check; #334): buildSlide's page, the fit
// script, the screenshot after it, the PNG master and the report. These run in CI's services job, the `render`
// Playwright project.

const LOGO: RenderAsset = {
  kind: 'image',
  key: 'logo_light_1',
  contentType: 'image/png',
  data: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const LONG_TITLE = Array.from({ length: 80 }, () => 'Winter').join(' ');

test('a slide that fits: the PNG master at its size and a passing report at k 1', async () => {
  const renderer = createRenderer({ log: () => undefined });
  try {
    const drawn = await renderPostSlide(renderer, testPost(), 'portrait', [LOGO]);
    const png = Buffer.from(drawn.png);
    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1350]);
    expect(FitReportSchema.parse(drawn.report)).toEqual({
      size: 'portrait',
      slide: 1,
      k: 1,
      status: 'pass',
      fields: [],
    });
    expect(drawn.render).toMatchObject({ width: 1080, height: 1350, blocked: [], errors: [] });
  } finally {
    await renderer.close();
  }
});

test('a slide that does not fit: still drawn, and the report names the title with its numbers', async () => {
  const renderer = createRenderer({ log: () => undefined });
  try {
    const post = testPost(testSlide({ title: LONG_TITLE }));
    const drawn = await renderPostSlide(renderer, post, 'square', [LOGO]);
    expect(Buffer.from(drawn.png).subarray(0, 8)).toEqual(PNG_SIGNATURE);
    const report = FitReportSchema.parse(drawn.report);
    expect(report).toMatchObject({ size: 'square', slide: 1, k: 0.85, status: 'fail' });
    const [title] = report.fields;
    expect(title).toMatchObject({ field: 'slides[0].title', graphemes: LONG_TITLE.length });
    expect(title?.lines).toBeGreaterThan(1);
    expect(title?.overflowPx).toBeGreaterThan(0);
    expect(title?.targetGraphemes).toBeLessThan(LONG_TITLE.length);
  } finally {
    await renderer.close();
  }
});

test('the size with the least text room is rendered first', async () => {
  const room = (size: (typeof SIZE_NAMES)[number]) =>
    SIZES[size].textArea.width * SIZES[size].textArea.height;
  const order = await orderOf([...SIZE_NAMES].reverse());
  expect([...order].sort()).toEqual([...SIZE_NAMES].sort());
  expect(order.map(room)).toEqual(order.map(room).sort((a, b) => a - b));
});

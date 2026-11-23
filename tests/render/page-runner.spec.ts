import { chromium, expect, test, type Browser } from '@playwright/test';
import {
  createRenderer,
  LAUNCH_OPTIONS,
  PAGE_ORIGIN,
  RenderFailure,
  type Log,
  type RenderAsset,
  type RendererOptions,
} from '../../packages/render/src/browser/index.ts';
import { FONT_MANIFEST } from '../../packages/render/src/fonts/library.ts';
import {
  testBanglaPost,
  testPost,
  testSlide,
} from '../../packages/render/src/page/test-fixtures.ts';
import { slidePage } from './slides.ts';

// The Chromium page runner in a real Chromium (§08 Chrome in Docker, Security, Fonts; #333). These run in CI's
// services job, the `render` Playwright project.

/** A 1×1 PNG, the logo of every test page. */
const LOGO: RenderAsset = {
  kind: 'image',
  key: 'logo_light_1',
  contentType: 'image/png',
  data: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
};

type Logged = { event: string; fields: Record<string, unknown> }[];

const collect =
  (logged: Logged): Log =>
  (event, fields = {}) => {
    logged.push({ event, fields });
  };

/** A renderer whose log is collected and whose browser launches are counted (and can be crashed). */
function setup(options: Partial<RendererOptions> & { onLaunch?: (browser: Browser) => void } = {}) {
  const logged: Logged = [];
  const log = collect(logged);
  const launched: Browser[] = [];
  const renderer = createRenderer({
    log,
    ...options,
    launch: async () => {
      const browser = await chromium.launch(LAUNCH_OPTIONS);
      launched.push(browser);
      options.onLaunch?.(browser);
      return browser;
    },
  });
  return { renderer, logged, launched };
}

const render = (renderer: ReturnType<typeof setup>['renderer'], html: string) =>
  renderer.renderPage({ html, assets: [LOGO], size: 'portrait', jobId: 'job-1' });

/** A plain page, with no content policy, so its own scripts run. */
const plain = (body: string, head = '') =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;

const NUNITO_400 = FONT_MANIFEST.fonts
  .find((font) => font.family === 'Nunito')
  ?.files.find((file) => file.weight === 400 && file.subset === 'latin')?.sha256;

/** A renderer as the worker makes it: its own launch, with the fixed flags. */
function plainSetup() {
  const logged: Logged = [];
  return { renderer: createRenderer({ log: collect(logged) }), logged };
}

test('renders a slide to a PNG master at its size, serving only its own assets and the manifest fonts', async () => {
  const { renderer, logged } = plainSetup();
  try {
    const result = await render(renderer, await slidePage(testPost()));
    // A PNG, 1080 × 1350 in its header.
    const png = Buffer.from(result.png);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1350]);
    expect(result).toMatchObject({ width: 1080, height: 1350, blocked: [], errors: [] });
    expect(result.served).toContain('image/logo_light_1');
    expect(result.served.some((served) => /^font\/[0-9a-f]{64}$/.test(served))).toBe(true);
    // Chrome's own report: the text was drawn by the page's fonts.
    const families = result.fonts.flatMap((block) => block.fonts.map((font) => font.family));
    expect(families).toContain('Nunito');
    expect(logged).toEqual([]);
  } finally {
    await renderer.close();
  }
});

test('opens a fresh context for every render: no storage or cookie carries over', async () => {
  const { renderer } = plainSetup();
  // Each render reads, then writes, local storage and a cookie. Anything found from before is reported by a request
  // to leak.example; the request to probe.example shows that writing them works on the page's origin.
  const html = plain(`<p>Storage</p><script>
    const before = localStorage.getItem('seen') !== null || document.cookie.includes('seen=');
    localStorage.setItem('seen', '1');
    document.cookie = 'seen=1; max-age=3600; path=/';
    if (before) fetch('https://leak.example/seen').catch(() => undefined);
    if (localStorage.getItem('seen') === '1' && document.cookie.includes('seen=1'))
      fetch('https://probe.example/stored').catch(() => undefined);
  </script>`);
  try {
    const first = await render(renderer, html);
    const second = await render(renderer, html);
    for (const result of [first, second])
      expect(result.blocked.map((blocked) => blocked.url)).toEqual([
        'https://probe.example/stored',
      ]);
  } finally {
    await renderer.close();
  }
});

test('blocks a remote image and a fetch to another host, and logs them by origin and path only', async () => {
  const { renderer, logged } = setup();
  try {
    const result = await render(
      renderer,
      plain(
        `<script>fetch('https://api.example.net/collect?id=42#x').catch(() => undefined);</script>` +
          `<p>Remote</p><img src="https://cdn.example.com/a.png?token=secret" alt="">`,
      ),
    );
    expect(result.blocked).toEqual(
      expect.arrayContaining([
        { url: 'https://api.example.net/collect', type: 'fetch' },
        { url: 'https://cdn.example.com/a.png', type: 'image' },
      ]),
    );
    expect(result.blocked).toHaveLength(2);
    expect(logged.map(({ event, fields }) => [event, fields.jobId, fields.url])).toEqual(
      expect.arrayContaining([
        ['render.request_blocked', 'job-1', 'https://api.example.net/collect'],
        ['render.request_blocked', 'job-1', 'https://cdn.example.com/a.png'],
      ]),
    );
    expect(JSON.stringify([result.blocked, logged])).not.toMatch(/token|secret|id=42|#/);
  } finally {
    await renderer.close();
  }
});

test('a remote link in a post’s text stays text: the slide makes no request', async () => {
  const { renderer } = setup();
  try {
    const post = testPost(
      testSlide({
        title: 'See <img src="https://evil.example/x.png"> and url(https://evil.example/y)',
      }),
    );
    const result = await render(renderer, await slidePage(post));
    expect(result.blocked).toEqual([]);
  } finally {
    await renderer.close();
  }
});

test('a font that fails to load fails the render with the font’s name', async () => {
  const { renderer } = setup();
  const face = (family: string, sha: string) =>
    `<style>@font-face { font-family: '${family}'; src: url(${PAGE_ORIGIN}/font/${sha}) format('woff2'); }
      p { font-family: '${family}'; }</style>`;
  try {
    // Not one of the job's assets: blocked, so it never loads.
    await expect(
      render(renderer, plain('<p>Hello</p>', face('Missing Face', 'b'.repeat(64)))),
    ).rejects.toThrow('The font "Missing Face" (weight normal) didn’t load');
    // One of the job's assets, but not a font.
    const broken: RenderAsset = {
      kind: 'font',
      key: 'c'.repeat(64),
      contentType: 'font/woff2',
      data: Buffer.from('not a font'),
    };
    const error: unknown = await renderer
      .renderPage({
        html: plain('<p>Hello</p>', face('Broken Face', broken.key)),
        assets: [broken],
        size: 'portrait',
        jobId: 'job-1',
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RenderFailure);
    expect((error as RenderFailure).reason).toBe(
      'The font "Broken Face" (weight normal) didn’t load',
    );
  } finally {
    await renderer.close();
  }
});

test('Chrome’s report of the fonts that drew each block: a fallback is an error, the page’s own fonts are not', async () => {
  const { renderer } = setup();
  try {
    // Nunito has no Bangla: Chrome draws the Bangla with a system font.
    const latinOnly = plain(
      '<p>Latin text</p><h1 lang="bn">বাংলা লেখা</h1>',
      `<style>@font-face { font-family: 'Nunito'; src: url(${PAGE_ORIGIN}/font/${String(NUNITO_400)}) format('woff2'); }
        p, h1 { font-family: 'Nunito'; font-weight: 400; }</style>`,
    );
    const fellBack = await render(renderer, latinOnly);
    // One system font or more drew the Bangla, and only there.
    expect(fellBack.errors.length).toBeGreaterThan(0);
    for (const error of fellBack.errors) {
      expect(error).toMatchObject({ code: 'font-fallback', block: 'h1' });
      expect(error.family).not.toBe('Nunito');
      expect(error.message).toMatch(
        /^h1: \d+ glyphs? (was|were) drawn by ".+", a font the page didn’t load$/,
      );
    }
    expect(fellBack.fonts.find((block) => block.block === 'p')?.fonts).toEqual([
      expect.objectContaining({ family: 'Nunito', custom: true }),
    ]);

    // A Bangla slide in its kit's fonts: every glyph is the page's own.
    const bangla = await render(renderer, await slidePage(testBanglaPost()));
    expect(bangla.errors).toEqual([]);
    const families = new Set(
      bangla.fonts.flatMap((block) => block.fonts.map((font) => font.family)),
    );
    expect([...families]).toContain('Hind Siliguri');
    expect(bangla.fonts.every((block) => block.fonts.every((font) => font.custom))).toBe(true);
  } finally {
    await renderer.close();
  }
});

const NEVER_FINISHES = plain('<p>Busy</p><script>for (;;) {}</script>');

test('a page that never finishes stops at the slide limit with a plain reason, and the browser renders on', async () => {
  const { renderer, launched } = setup({ limits: { slideMs: 1_500 } });
  try {
    const started = Date.now();
    const error: unknown = await render(renderer, NEVER_FINISHES).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RenderFailure);
    expect((error as RenderFailure).reason).toBe('The slide didn’t finish rendering within 1.5 s');
    expect(Date.now() - started).toBeLessThan(10_000);

    const next = await render(renderer, await slidePage(testPost()));
    expect(next.errors).toEqual([]);
    expect(launched).toHaveLength(1);
  } finally {
    await renderer.close();
  }
});

test('a browser crash is retried once in a new browser', async () => {
  // The first browser is killed while the page is still busy; the second is left alone.
  const { renderer, launched } = setup({
    onLaunch: (browser) => {
      if (launched.length === 1) setTimeout(() => void browser.close(), 1_000);
    },
  });
  try {
    const busy = plain(
      '<p>Slow</p><script>const t = Date.now(); while (Date.now() - t < 3000) {}</script>',
    );
    const result = await render(renderer, busy);
    expect(result.errors).toEqual([]);
    expect(launched).toHaveLength(2);
  } finally {
    await renderer.close();
  }
});

test('a browser that crashes again fails the render with a plain reason', async () => {
  const { renderer, launched, logged } = setup({
    onLaunch: (browser) => {
      setTimeout(() => void browser.close(), 1_000);
    },
  });
  try {
    const error: unknown = await render(renderer, NEVER_FINISHES).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RenderFailure);
    expect((error as RenderFailure).reason).toBe(
      'The render browser crashed twice on this slide, so it wasn’t rendered',
    );
    expect(launched).toHaveLength(2);
    expect(logged.filter(({ event }) => event === 'render.browser_crashed')).toHaveLength(2);
  } finally {
    await renderer.close();
  }
});

test('the browser restarts after the configured number of renders (lowered to 2)', async () => {
  const { renderer, launched } = setup({ limits: { rendersPerBrowser: 2 } });
  try {
    for (let i = 0; i < 5; i++) await render(renderer, plain('<p>Count</p>'));
    expect(launched).toHaveLength(3);
    expect(launched.map((browser) => browser.isConnected())).toEqual([false, false, true]);
  } finally {
    await renderer.close();
  }
});

test('the browser restarts when its memory passes the configured limit (lowered to 1 byte)', async () => {
  // The memory probe reads /proc, as on CI's runner and in the worker's Linux image.
  const { renderer, launched } = setup({ limits: { browserMemoryBytes: 1 } });
  try {
    for (let i = 0; i < 3; i++) await render(renderer, plain('<p>Memory</p>'));
    expect(launched).toHaveLength(3);
  } finally {
    await renderer.close();
  }
});

test('two renders of the same page give identical PNG bytes, in one browser and in a new one', async () => {
  const html = await slidePage(testBanglaPost());
  const one = setup();
  const two = setup();
  try {
    const first = await render(one.renderer, html);
    const again = await render(one.renderer, html);
    const fresh = await render(two.renderer, html);
    expect(Buffer.from(again.png).equals(Buffer.from(first.png))).toBe(true);
    expect(Buffer.from(fresh.png).equals(Buffer.from(first.png))).toBe(true);
  } finally {
    await Promise.all([one.renderer.close(), two.renderer.close()]);
  }
});

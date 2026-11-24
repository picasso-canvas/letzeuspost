import { createHash } from 'node:crypto';
import { LookSchema, SIZE_NAMES, type Post } from '@lzp/core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FONT_MANIFEST } from '../fonts/library.ts';
import { SIZES } from '../sizes.ts';
import { ASSET_SCHEME } from './assets.ts';
import { buildSlide, buildSlideWithWarnings } from './build-slide.ts';
import { FIT_SCRIPT } from '../fit/script.ts';
import { registerLook } from './looks.ts';
import { TEST_LOOK, testBanglaPost, testKit, testPost, testSlide } from './test-fixtures.ts';

beforeAll(() => {
  registerLook(TEST_LOOK);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const build = (post: Post, size: (typeof SIZE_NAMES)[number] = 'portrait', kit = testKit()) => {
  const slide = post.slides[0];
  if (slide === undefined) throw new Error('the test post has no slide');
  return buildSlide(post, slide, size, kit);
};

const styleOf = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
const bodyClasses = (html: string) =>
  (/<body class="([^"]*)"/.exec(html)?.[1] ?? '').split(' ').filter(Boolean);
const policyOf = (html: string) =>
  /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '';

describe('buildSlide: a full HTML document', () => {
  it('returns a document with the post language, the look and the size on it', () => {
    const html = build(testPost());
    expect(html.startsWith('<!DOCTYPE html><html lang="en"')).toBe(true);
    expect(html.endsWith('</html>')).toBe(true);
    expect(bodyClasses(html)).toEqual(expect.arrayContaining(['look-clean', 'size-portrait']));
    expect(build(testBanglaPost()).startsWith('<!DOCTYPE html><html lang="bn"')).toBe(true);
  });

  it("puts the registered look's CSS and tokens on the page", () => {
    const style = styleOf(build(testPost()));
    expect(style).toContain(TEST_LOOK.css);
    expect(style).toMatch(/--look-test-token:\s*#123456/);
  });

  it("puts the brand's colours on the page as CSS variables", () => {
    const style = styleOf(build(testPost()));
    expect(style).toMatch(/--primary:\s*#e4572e/);
    expect(style).toMatch(/--accent:\s*#17bebb/);
    expect(style).toMatch(/--background:\s*#fff8f0/);
    expect(style).toMatch(/--ink:\s*#1b1b1b/);
    expect(style).toMatch(/--extra-1:\s*#ffc914/);
  });

  it('declares the fonts of the kit for the post language, served by the job (no web address)', () => {
    const style = styleOf(build(testBanglaPost()));
    const hind = FONT_MANIFEST.fonts.find((font) => font.family === 'Hind Siliguri');
    expect(style).toContain("font-family: 'Hind Siliguri'");
    for (const file of hind?.files ?? []) {
      expect(style).toContain(`${ASSET_SCHEME}:font/${file.sha256}`);
    }
    expect(style).not.toContain("font-family: 'Nunito'");
    expect(style).toMatch(/--font-heading:\s*'Hind Siliguri'/);
  });

  it('refuses a look that no one registered, and a layout that is not built yet', () => {
    const bold = testPost(testSlide(), { look: { name: 'bold', switches: {} } });
    expect(() => build(bold)).toThrow(/bold/);
    const meme = { layout: 'meme', panels: [{ mascot: true, label: 'l' }], text: 't', alt: 'a' } as const;
    expect(() => buildSlide(testPost(), meme, 'portrait', testKit())).toThrow(/meme/);
  });

  it('refuses a colour that is not hex: it would end up in CSS', () => {
    const kit = testKit();
    const bad = { ...kit, colors: { ...kit.colors, ink: 'red; } body { background: url(x)' } };
    expect(() => build(testPost(), 'portrait', bad)).toThrow();
  });
});

describe('buildSlide: deterministic', () => {
  it('gives a byte-identical string for the same input', () => {
    const first = build(testPost());
    expect(build(testPost())).toBe(first);
    expect(build(testPost())).toBe(first);
  });

  it('never reads the clock, a random number or the network', () => {
    const forbidden = (name: string) => () => {
      throw new Error(`buildSlide called ${name}`);
    };
    vi.spyOn(Date, 'now').mockImplementation(forbidden('Date.now'));
    vi.spyOn(Math, 'random').mockImplementation(forbidden('Math.random'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(forbidden('fetch'));
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
      forbidden('crypto.getRandomValues'),
    );
    for (const size of SIZE_NAMES) expect(build(testPost(), size)).toContain('<main');
    expect(build(testBanglaPost())).toContain('<main');
  });

  it('differs when the content differs', () => {
    expect(build(testPost(testSlide({ title: 'Another title' })))).not.toBe(build(testPost()));
  });
});

describe('buildSlide: post text is escaped', () => {
  const nasty = `<script>alert(1)</script> & "quotes" 'single' </style>`;

  it('shows a title with <script>, & and quotes as text', () => {
    const html = build(testPost(testSlide({ title: nasty })));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('</style> ');
  });

  it('escapes the kicker, body, source and alt text as well', () => {
    const html = build(
      testPost(testSlide({ kicker: nasty, body: nasty, source: nasty, alt: nasty })),
    );
    expect(html.split('&lt;script&gt;alert(1)').length - 1).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain('<script>alert');
  });

  it('has exactly one script on the page: the fit script', () => {
    const html = build(testPost(testSlide({ title: nasty, body: nasty })));
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain(`<script>${FIT_SCRIPT}</script>`);
  });

  it('turns *word* into an element through parseHighlights, never into raw HTML', () => {
    const html = build(testPost(testSlide({ title: 'Pitha is *older* than tea' })));
    expect(html).toContain('Pitha is <mark class="hl">older</mark> than tea');
  });

  it('escapes the text inside a highlight', () => {
    const html = build(testPost(testSlide({ title: 'A *<b onclick=x>bold</b>* claim' })));
    expect(html).toContain('<mark class="hl">&lt;b onclick=x&gt;bold&lt;/b&gt;</mark>');
    expect(html).not.toContain('<b onclick');
  });

  it('keeps a marker that is not a highlight as a plain asterisk', () => {
    const html = build(testPost(testSlide({ title: 'Five*stars' })));
    expect(html).toContain('Five*stars');
    expect(html).not.toContain('<mark');
  });

  it('writes Bangla highlights as an element too', () => {
    const html = build(testBanglaPost());
    expect(html).toContain('ফিরে এল <mark class="hl">পিঠা</mark> সপ্তাহ');
  });
});

describe('buildSlide: no remote image', () => {
  it('renders no <img> for a logo that is a remote URL, and returns a warning', () => {
    const kit = testKit();
    const remote = { ...kit, logo: { ...kit.logo, light: 'https://evil.test/logo.png' } };
    const slide = testSlide();
    const { html, warnings } = buildSlideWithWarnings(testPost(slide), slide, 'portrait', remote);
    expect(html).not.toContain('evil.test');
    expect(html).not.toMatch(/<img[^>]*evil/);
    expect(warnings).toEqual([expect.objectContaining({ code: 'image-not-an-asset' })]);
    expect(warnings[0]?.field).toBe('kit.logo.light');
  });

  it("renders the kit's logo as an <img> from the asset scheme", () => {
    const html = build(testPost());
    expect(html).toContain(`<img src="${ASSET_SCHEME}:image/logo_light_1"`);
  });

  it("chooses the kit's dark logo on a dark background", () => {
    const kit = testKit();
    const dark = { ...kit, colors: { ...kit.colors, background: '#101820', ink: '#ffffff' } };
    const html = build(testPost(), 'portrait', dark);
    expect(html).toContain(`<img src="${ASSET_SCHEME}:image/logo_dark_1"`);
    expect(html).not.toContain('logo_light_1');
  });

  it('has no warnings for a good post', () => {
    const slide = testSlide();
    expect(buildSlideWithWarnings(testPost(slide), slide, 'portrait', testKit()).warnings).toEqual(
      [],
    );
  });

  it('has no web address anywhere on the page, nor a protocol-relative one', () => {
    const html = build(testPost());
    expect(html).not.toMatch(/https?:/i);
    expect(html).not.toMatch(/(?:src|href)="\/\//);
    for (const url of styleOf(html).matchAll(/url\(([^)]*)\)/g)) {
      expect(url[1]?.replace(/['"]/g, '')).toMatch(new RegExp(`^${ASSET_SCHEME}:`));
    }
  });
});

describe('buildSlide: the content policy', () => {
  const directives = (html: string) =>
    new Map(
      policyOf(html.replace(/&#x27;/g, "'"))
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const [name = '', ...sources] = part.split(/\s+/);
          return [name, sources] as const;
        }),
    );

  it('is on the page, ahead of everything, and denies by default', () => {
    const html = build(testPost());
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<style'));
    expect(directives(html).get('default-src')).toEqual(["'none'"]);
  });

  it("allows scripts only by the fit script's hash", () => {
    const html = build(testPost());
    const hash = createHash('sha256').update(FIT_SCRIPT, 'utf8').digest('base64');
    expect(directives(html).get('script-src')).toEqual([`'sha256-${hash}'`]);
    expect(policyOf(html)).not.toMatch(/unsafe-|strict-dynamic/);
  });

  it('allows the one style of the page only by its hash, so nothing needs unsafe-inline', () => {
    const html = build(testPost());
    const hash = createHash('sha256').update(styleOf(html), 'utf8').digest('base64');
    expect(directives(html).get('style-src')).toEqual([`'sha256-${hash}'`]);
  });

  it("allows images and fonts only from the job's own asset scheme", () => {
    const html = build(testPost());
    expect(directives(html).get('img-src')).toEqual([`${ASSET_SCHEME}:`]);
    expect(directives(html).get('font-src')).toEqual([`${ASSET_SCHEME}:`]);
    expect(directives(html).get('connect-src')).toBeUndefined(); // falls back to default-src 'none'
  });

  it('allows no frames, forms or base address', () => {
    const d = directives(build(testPost()));
    expect(d.get('base-uri')).toEqual(["'none'"]);
    expect(d.get('form-action')).toEqual(["'none'"]);
    expect(d.get('frame-src')).toBeUndefined();
  });
});

describe('buildSlide: the text layout in five sizes', () => {
  it.each(SIZE_NAMES)('%s: kicker, title, body and source', (size) => {
    const html = build(testPost(), size);
    expect(bodyClasses(html)).toContain(`size-${size}`);
    expect(html).toContain('<main class="slide layout-text">');
    expect(html).toContain('<p class="kicker">Did you know</p>');
    expect(html).toContain(
      '<h1 class="title">Pitha is <mark class="hl">older</mark> than tea</h1>',
    );
    expect(html).toContain('<p class="body">Rice cakes were made here for centuries.</p>');
    expect(html).toContain('<p class="source small-print">Source: Bangla Academy, 2019</p>');
    const { width, height, margins, bodyFloor } = SIZES[size];
    const css = styleOf(html);
    expect(css).toMatch(new RegExp(`--w:\\s*${String(width)}px`));
    expect(css).toMatch(new RegExp(`--h:\\s*${String(height)}px`));
    expect(css).toMatch(new RegExp(`--mt:\\s*${String(margins.top)}px`));
    expect(css).toMatch(new RegExp(`--mr:\\s*${String(margins.right)}px`));
    expect(css).toMatch(new RegExp(`--mb:\\s*${String(margins.bottom)}px`));
    expect(css).toMatch(new RegExp(`--ml:\\s*${String(margins.left)}px`));
    expect(css).toMatch(new RegExp(`--body-floor:\\s*${String(bodyFloor)}px`));
  });

  it('has no source line without a source', () => {
    const html = build(testPost(testSlide({ source: undefined })));
    expect(html).not.toContain('class="source');
  });

  it('keeps a story inside its safe zones: top 250, right 130, bottom 384, left 72', () => {
    const css = styleOf(build(testPost(), 'story'));
    expect(css).toMatch(/--mt:\s*250px/);
    expect(css).toMatch(/--mr:\s*130px/);
    expect(css).toMatch(/--mb:\s*384px/);
    expect(css).toMatch(/--ml:\s*72px/);
  });

  it('is two columns on landscape and stacked everywhere else', () => {
    for (const size of SIZE_NAMES) {
      const html = build(testPost(), size);
      expect(bodyClasses(html)).toContain(SIZES[size].arrangement === 'columns' ? 'cols' : 'stack');
      expect(html.includes('class="col col-text"')).toBe(size === 'landscape');
      expect(html.includes('class="col col-detail"')).toBe(size === 'landscape');
    }
  });

  it('puts the kicker and title in the left column and the body and source in the right', () => {
    const html = build(testPost(), 'landscape');
    const left = html.indexOf('class="col col-text"');
    const right = html.indexOf('class="col col-detail"');
    expect(left).toBeLessThan(html.indexOf('class="kicker"'));
    expect(html.indexOf('class="title"')).toBeLessThan(right);
    expect(html.indexOf('class="body"')).toBeGreaterThan(right);
    expect(html.indexOf('class="source')).toBeGreaterThan(right);
  });

  it('numbers the pages of a carousel in the language of the post', () => {
    const slides = [testSlide(), testSlide({ title: 'Second' }), testSlide({ title: 'Third' })];
    const post = testPost(testSlide(), { kind: 'carousel', slides });
    const second = slides[1];
    if (second === undefined) throw new Error('no second slide');
    expect(buildSlide(post, second, 'portrait', testKit())).toContain(
      '<span class="page-number">2/3</span>',
    );
    const bn = testBanglaPost();
    const bnSlides = [...bn.slides, ...bn.slides.map((s) => ({ ...s }))];
    const bnPost = { ...bn, kind: 'carousel' as const, slides: bnSlides };
    const bnSecond = bnSlides[1];
    if (bnSecond === undefined) throw new Error('no second slide');
    expect(buildSlide(bnPost, bnSecond, 'portrait', testKit())).toContain(
      '<span class="page-number">২/২</span>',
    );
  });

  it('has no page number on a single image', () => {
    expect(build(testPost())).not.toContain('class="page-number"');
  });

  it('labels the source in the post language', () => {
    expect(build(testBanglaPost())).toContain('সূত্র: বাংলা একাডেমি');
  });
});

describe('buildSlide: Bangla', () => {
  it('gives body at least 1.65 and headings at least 1.3 as line-height', () => {
    const css = styleOf(build(testBanglaPost()));
    const number = (name: string) => Number(new RegExp(`--${name}:\\s*([\\d.]+)`).exec(css)?.[1]);
    expect(number('lh-body')).toBeGreaterThanOrEqual(1.65);
    expect(number('lh-heading')).toBeGreaterThanOrEqual(1.3);
  });

  it('uses the manifest line-heights of the Bangla fonts when they are larger', () => {
    const hind = FONT_MANIFEST.fonts.find((font) => font.family === 'Hind Siliguri');
    const css = styleOf(build(testBanglaPost()));
    expect(Number(/--lh-body:\s*([\d.]+)/.exec(css)?.[1])).toBeGreaterThanOrEqual(
      hind?.banglaLineHeight?.body ?? 99,
    );
  });
});

describe('buildSlide: switches become classes', () => {
  const withSwitches = (switches: Record<string, unknown>) =>
    testPost(testSlide(), { look: { name: 'clean', switches } });

  it.each([
    ['corners', 'sharp', 'corners-sharp'],
    ['corners', 'soft', 'corners-soft'],
    ['corners', 'round', 'corners-round'],
    ['frame', 'none', 'frame-none'],
    ['frame', 'print', 'frame-print'],
    ['frame', 'rounded', 'frame-rounded'],
    ['frame', 'full-bleed', 'frame-full-bleed'],
    ['highlight', 'default', 'hl-default'],
    ['highlight', 'pill', 'hl-pill'],
    ['highlight', 'underline', 'hl-underline'],
    ['highlight', 'color', 'hl-color'],
    ['decorations', false, 'decor-off'],
    ['decorations', true, 'decor-on'],
    ['logo', 'bottom-left', 'logo-bottom-left'],
    ['logo', 'bottom-right', 'logo-bottom-right'],
    ['logo', 'top', 'logo-top'],
  ] as const)('%s = %s gives %s', (name, value, expected) => {
    expect(bodyClasses(build(withSwitches({ [name]: value })))).toContain(expected);
  });

  it('gives the §08 example: corners-round frame-print hl-pill decor-off logo-top', () => {
    const classes = bodyClasses(
      build(
        withSwitches({
          corners: 'round',
          frame: 'print',
          highlight: 'pill',
          decorations: false,
          logo: 'top',
        }),
      ),
    );
    expect(classes).toEqual(
      expect.arrayContaining(['corners-round', 'frame-print', 'hl-pill', 'decor-off', 'logo-top']),
    );
  });

  it('puts a switch that is not set at its default, so every switch has a class', () => {
    const classes = bodyClasses(build(testPost()));
    for (const prefix of ['corners-', 'frame-', 'hl-', 'decor-', 'logo-']) {
      expect(classes.filter((name) => name.startsWith(prefix))).toHaveLength(1);
    }
  });

  it('puts the logo at the top of a pin unless the brand says otherwise (§08)', () => {
    expect(bodyClasses(build(testPost(), 'pin'))).toContain('logo-top');
    expect(bodyClasses(build(withSwitches({ logo: 'bottom-right' }), 'pin'))).toContain(
      'logo-bottom-right',
    );
  });

  it.each([
    ['corners', 'pointy'],
    ['frame', 'polaroid'],
    ['highlight', 'neon'],
    ['decorations', 'yes'],
    ['logo', 'middle'],
    ['shadow', 'long'],
  ])('rejects %s = %s with the schema instead of ignoring it', (name, value) => {
    expect(LookSchema.safeParse({ name: 'clean', switches: { [name]: value } }).success).toBe(
      false,
    );
    expect(() => build(withSwitches({ [name]: value }))).toThrow();
  });
});

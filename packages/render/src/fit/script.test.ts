import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { FIT_SCRIPT } from './script.ts';

// The fit script runs in a page, and the real-browser specs (tests/render/fit.spec.ts) measure real text. These tests
// run the same script text against a small stand-in for the page whose block heights follow `--k`, so the search
// itself (which `k` it picks, what it counts as not fitting, what it names, what it waits for) is checked in every
// run, without a browser.

type Block = {
  name: 'kicker' | 'title' | 'body' | 'source' | 'cta-line' | 'sticker' | 'step-label';
  /** Height at `--k` 1; a heading or body block grows and shrinks with k² (font size and line count). */
  height: number;
  /** The line height at k = 1, so `lines` is height ÷ line height. */
  line: number;
  /** The width of its longest line at k; the block is 952 wide. */
  wide?: (k: number) => number;
};

type Spec = {
  blocks: Block[];
  area?: number;
  gap?: number;
  /** Height of an `.image-box` at k (it sits first in the text area). */
  image?: (k: number) => number;
  pageHeight?: number;
};

/** The blocks in small print: a fixed 28 px, whatever `--k` is. */
const FIXED: Block['name'][] = ['source', 'sticker', 'step-label'];

const AREA_TOP = 64;
const WIDTH = 952;

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A stand-in for the page: what the script reads, with heights from `--k`. */
function fakePage(spec: Spec, gates: { font?: Promise<void>; image?: Promise<void> } = {}) {
  const { area = 1000, gap = 20, pageHeight = 1350 } = spec;
  const log: string[] = [];
  const state = { k: 1 };
  const dataset: Record<string, string> = {};

  const scaled = (block: Block) =>
    FIXED.includes(block.name) ? block.height : block.height * state.k ** 2;
  const heights = () => [
    ...(spec.image === undefined ? [] : [spec.image(state.k)]),
    ...spec.blocks.map(scaled),
  ];
  const needed = () => heights().reduce((a, b) => a + b, 0) + gap * (heights().length - 1);
  const rect = (top: number, height: number) => ({
    top,
    bottom: top + height,
    left: AREA_TOP,
    right: AREA_TOP + WIDTH,
    width: WIDTH,
    height,
  });
  const topOf = (index: number) =>
    AREA_TOP +
    (area - needed()) / 2 +
    heights()
      .slice(0, index)
      .reduce((sum, h) => sum + h + gap, 0);

  const styles = new Map<object, Record<string, string>>();
  const styleLog: string[] = [];
  const style = (owner: object) => {
    const own = styles.get(owner) ?? {};
    styles.set(owner, own);
    return {
      setProperty: (name: string, value: string) => {
        own[name] = value;
        styleLog.push(`${name}:${value}`);
      },
      removeProperty: (name: string) => {
        Reflect.deleteProperty(own, name);
      },
    };
  };

  const offset = spec.image === undefined ? 0 : 1;
  const blockElements = spec.blocks.map((block, index) => {
    const element = {
      classList: {
        contains: (name: string) =>
          name === block.name || (FIXED.includes(block.name) && name === 'small-print'),
      },
      getBoundingClientRect: () => rect(topOf(index + offset), scaled(block)),
      get scrollWidth() {
        return Math.max(WIDTH, block.wide?.(state.k) ?? 0);
      },
      clientWidth: WIDTH,
      style: style(block),
      closest: () => null,
      block,
    };
    return element;
  });
  const imageElements =
    spec.image === undefined
      ? []
      : [
          {
            getBoundingClientRect: () => rect(topOf(0), spec.image?.(state.k) ?? 0),
          },
        ];

  const textArea = {
    getBoundingClientRect: () => rect(AREA_TOP, area),
    querySelectorAll: () => blockElements,
    get children() {
      return [...imageElements, ...blockElements];
    },
  };

  const root = {
    style: {
      setProperty: (name: string, value: string) => {
        log.push(`${name}=${value}`);
        if (name === '--k') state.k = Number(value);
      },
    },
    dataset,
  };

  const fonts = Object.assign(
    [{ load: () => (gates.font ?? Promise.resolve()).then(() => undefined) }],
    { ready: Promise.resolve() },
  );
  const images = [{ decode: () => (gates.image ?? Promise.resolve()).then(() => undefined) }];

  const sandbox: Record<string, unknown> = {
    document: {
      fonts,
      images,
      documentElement: root,
      body: { getBoundingClientRect: () => rect(0, pageHeight) },
      querySelector: () => textArea,
      querySelectorAll: () => imageElements,
    },
    getComputedStyle: (element: { block?: Block }) => ({
      lineHeight: `${String(element.block === undefined ? 0 : element.block.line * state.k)}px`,
      fontSize: '40px',
    }),
  };
  sandbox.window = sandbox;
  return { sandbox, log, dataset, styles, styleLog };
}

/** Runs the script on the stand-in and returns what it reports. */
async function run(spec: Spec, gates?: Parameters<typeof fakePage>[1]) {
  const page = fakePage(spec, gates);
  runInNewContext(FIT_SCRIPT, page.sandbox);
  const reported = await page.sandbox.lzpFit;
  return { reported, page };
}

const KICKER: Block = { name: 'kicker', height: 60, line: 60 };
const TITLE: Block = { name: 'title', height: 400, line: 100 };
const BODY: Block = { name: 'body', height: 300, line: 60 };
const SOURCE: Block = { name: 'source', height: 40, line: 40 };
const TEXT = [KICKER, TITLE, BODY, SOURCE];

/** The height the text needs at k, to give a text area that fits it at exactly that k and no larger one. */
const roomFor = (k: number, blocks = TEXT, gap = 20) =>
  blocks.reduce((sum, b) => sum + (FIXED.includes(b.name) ? b.height : b.height * k ** 2), 0) +
  gap * (blocks.length - 1);

describe('the fit script: which k it picks', () => {
  it('reports k 1 for a slide that fits at 1.00, and goes no lower', async () => {
    const { reported, page } = await run({ blocks: TEXT, area: 1000 });
    expect(reported).toEqual({ k: 1, fits: true, fields: [] });
    expect(page.log.filter((entry) => entry.startsWith('--k='))).toEqual(['--k=1']);
  });

  it('picks the largest k at which it fits: 0.90 for a slide that needs 0.90', async () => {
    const { reported } = await run({ blocks: TEXT, area: roomFor(0.9) + 0.1 });
    expect(reported).toEqual({ k: 0.9, fits: true, fields: [] });
  });

  it('can pick any step between 1.00 and 0.85, down to exactly 0.85', async () => {
    const picked = [];
    for (const k of [0.99, 0.93, 0.87, 0.85]) {
      const { reported } = await run({ blocks: TEXT, area: roomFor(k) + 0.1 });
      picked.push((reported as { k: number }).k);
    }
    expect(picked).toEqual([0.99, 0.93, 0.87, 0.85]);
  });

  it('leaves the page at the k it picked', async () => {
    const { page } = await run({ blocks: TEXT, area: roomFor(0.9) + 0.1 });
    expect(page.log.at(-1)).toBe('--k=0.9');
    expect(page.dataset).toMatchObject({ fit: 'done', fitK: '0.9' });
  });

  it('measures boxes with half a pixel to spare, not a glyph at a time', async () => {
    const exact = await run({ blocks: TEXT, area: roomFor(1) });
    const short = await run({ blocks: TEXT, area: roomFor(1) - 0.4 });
    const over = await run({ blocks: TEXT, area: roomFor(1) - 5 });
    expect((exact.reported as { k: number }).k).toBe(1);
    expect((short.reported as { k: number }).k).toBe(1);
    expect((over.reported as { k: number }).k).toBeLessThan(1);
  });
});

describe('the fit script: a slide that does not fit at 0.85', () => {
  const area = roomFor(0.85) - 100;

  it('reports fits: false at k 0.85 and leaves the page at 0.85', async () => {
    const { reported, page } = await run({ blocks: TEXT, area });
    expect(reported).toMatchObject({ k: 0.85, fits: false });
    expect(page.log.at(-1)).toBe('--k=0.85');
  });

  it('names the blocks that can be shortened with their lines, and shares the overflow out between them', async () => {
    const { reported } = await run({ blocks: TEXT, area });
    const { fields } = reported as {
      fields: {
        name: string;
        lines: number;
        needed: number;
        available: number;
        overflowPx: number;
      }[];
    };
    // The one-line kicker and the fixed source can't give back a line; the title and the body can.
    expect(fields.map((f) => f.name)).toEqual(['title', 'body']);
    // At 0.85: title 400 × 0.7225 = 289 px (lines = 289 ÷ 85 ≈ 3); body 300 × 0.7225 = 216.75 px
    expect(fields.map((f) => f.lines)).toEqual([3, 4]);
    // The overflow is 100 px, shared by height: the two overflows add up to it
    const total = fields.reduce((sum, f) => sum + f.overflowPx, 0);
    expect(total).toBeCloseTo(100, 1);
    for (const f of fields) {
      expect(f.available).toBeLessThan(f.needed);
      expect(f.overflowPx).toBeCloseTo(f.needed - f.available, 1);
    }
  });

  it('gives each field the room that makes the whole text fit once every named field is cut to its target', async () => {
    const { reported } = await run({ blocks: TEXT, area });
    const { fields } = reported as { fields: { needed: number; available: number }[] };
    const fixed = 60 * 0.7225 + 40 + 3 * 20; // the kicker, the source and the gaps stay as they are
    const room = fields.reduce((sum, f) => sum + f.available, 0);
    expect(room + fixed).toBeCloseTo(area, 1);
  });

  it('names every field when none of them has a second line to give back', async () => {
    const one: Block[] = [
      { name: 'kicker', height: 60, line: 60 },
      { name: 'title', height: 100, line: 100 },
    ];
    const { reported } = await run({ blocks: one, area: 50 });
    expect((reported as { fields: { name: string }[] }).fields.map((f) => f.name)).toEqual([
      'kicker',
      'title',
    ]);
  });

  it('asks for no room at all (not a negative one) when what cannot shrink is already too much', async () => {
    const { reported } = await run({
      blocks: [
        { name: 'title', height: 300, line: 100 },
        { name: 'source', height: 400, line: 40 },
      ],
      area: 300,
    });
    const { fields } = reported as { fields: { available: number }[] };
    expect(fields[0]?.available).toBe(0);
  });
});

describe('the fit script: no line overflows', () => {
  it('lowers k until the widest line is inside its block (a long word is wider at 1.00)', async () => {
    const wide: Block = { ...TITLE, wide: (k) => 1100 * k };
    const { reported } = await run({ blocks: [KICKER, wide, BODY, SOURCE], area: 1000 });
    // 1100 × k ≤ 952 → k ≤ 0.8654…
    expect(reported).toEqual({ k: 0.86, fits: true, fields: [] });
  });

  it('fails, naming the field and how far its line sticks out, when no k brings the line in', async () => {
    const wide: Block = { ...SOURCE, wide: () => 1200 };
    const { reported } = await run({ blocks: [KICKER, TITLE, wide], area: 1000 });
    expect(reported).toMatchObject({ k: 0.85, fits: false });
    const { fields } = reported as {
      fields: { name: string; overflowPx: number; available: number; needed: number }[];
    };
    // Small print never shrinks, but a source whose line runs out of the block is named, with the width it lacks
    expect(fields.map((f) => f.name)).toEqual(['source']);
    const [source] = fields;
    if (source === undefined) throw new Error('no field');
    expect(source.overflowPx).toBeCloseTo(1200 - 952, 1);
    expect(source.available / source.needed).toBeCloseTo(952 / 1200, 2);
  });

  it('measures with overflow-wrap off (a word broken mid-word would hide a line that is too wide), then puts it back', async () => {
    const { page } = await run({ blocks: TEXT, area: roomFor(0.9) + 0.1 });
    expect(page.styleLog).toContain('overflow-wrap:normal');
    for (const own of page.styles.values()) expect(own).toEqual({});
  });
});

describe('the fit script: the call to action, the sticker and the step label (#338)', () => {
  const CTA: Block = { name: 'cta-line', height: 80, line: 80 };
  const STICKER: Block = { name: 'sticker', height: 40, line: 40 };
  const STEP_LABEL: Block = { name: 'step-label', height: 40, line: 40 };
  type Named = { name: string; overflowPx: number; available: number; needed: number };

  it('names a call to action whose line is too wide by the slide field `cta`, with the width it lacks', async () => {
    const wide: Block = { ...CTA, wide: () => 1200 };
    const { reported } = await run({ blocks: [TITLE, BODY, wide], area: 1000 });
    expect(reported).toMatchObject({ k: 0.85, fits: false });
    const { fields } = reported as { fields: Named[] };
    expect(fields.map((f) => f.name)).toEqual(['cta']);
    expect(fields[0]?.overflowPx).toBeCloseTo(1200 - 952, 1);
  });

  it('names a sticker whose line is too wide by the slide field `sticker`', async () => {
    const wide: Block = { ...STICKER, wide: () => 1100 };
    const { reported } = await run({ blocks: [wide, KICKER, TITLE], area: 1000 });
    expect(reported).toMatchObject({ k: 0.85, fits: false });
    const { fields } = reported as { fields: Named[] };
    expect(fields.map((f) => f.name)).toEqual(['sticker']);
    expect(fields[0]?.overflowPx).toBeCloseTo(1100 - 952, 1);
  });

  it('counts the call to action among the text that can be shortened when the column is too tall', async () => {
    const tall: Block = { name: 'cta-line', height: 240, line: 80 };
    const blocks = [TITLE, BODY, tall];
    const { reported } = await run({ blocks, area: roomFor(0.85, blocks) - 100 });
    const { fields } = reported as { fields: Named[] };
    expect(fields.map((f) => f.name)).toEqual(['title', 'body', 'cta']);
    expect(fields.reduce((sum, f) => sum + f.overflowPx, 0)).toBeCloseTo(100, 1);
  });

  it('keeps a sticker and a step label at their fixed size: only k moves the rest', async () => {
    const blocks = [STICKER, KICKER, TITLE, STEP_LABEL];
    const { reported } = await run({ blocks, area: roomFor(0.9, blocks) + 0.1 });
    expect(reported).toEqual({ k: 0.9, fits: true, fields: [] });
  });

  it('measures the step label but names no field for it (it is made from n and of, there is no text of the slide to cut)', async () => {
    const wide: Block = { ...STEP_LABEL, wide: () => 1200 };
    const { reported } = await run({ blocks: [wide, TITLE], area: 1000 });
    expect(reported).toEqual({ k: 0.85, fits: false, fields: [] });
  });

  it('measures every block with overflow-wrap off, and puts it back', async () => {
    const { page } = await run({ blocks: [STICKER, CTA, STEP_LABEL], area: 1000 });
    expect(page.styleLog.filter((entry) => entry === 'overflow-wrap:normal')).toHaveLength(3);
    for (const own of page.styles.values()) expect(own).toEqual({});
  });
});

describe('the fit script: image boxes', () => {
  it('does not fit while an image box is under 26% of the page height, whatever the text needs', async () => {
    const small: Block = { name: 'title', height: 100, line: 100 };
    const { reported } = await run({
      blocks: [small],
      area: 1200,
      image: () => 0.25 * 1350,
      pageHeight: 1350,
    });
    expect(reported).toMatchObject({ k: 0.85, fits: false });
  });

  it('fits when the image box keeps its 26%', async () => {
    const small: Block = { name: 'title', height: 100, line: 100 };
    const { reported } = await run({
      blocks: [small],
      area: 1200,
      image: () => 0.26 * 1350,
      pageHeight: 1350,
    });
    expect(reported).toEqual({ k: 1, fits: true, fields: [] });
  });

  it('counts the image box as room the text cannot take (it is not a field)', async () => {
    const image = () => 0.3 * 1350;
    const { reported } = await run({
      blocks: [KICKER, TITLE, BODY],
      area: roomFor(0.9, [KICKER, TITLE, BODY]) + image() + 20 + 0.1,
      image,
    });
    expect(reported).toEqual({ k: 0.9, fits: true, fields: [] });
  });
});

describe('the fit script: waiting', () => {
  it('measures nothing until the fonts are loaded and the images decoded', async () => {
    const font = deferred();
    const image = deferred();
    const page = fakePage(
      { blocks: TEXT, area: 1000 },
      { font: font.promise, image: image.promise },
    );
    runInNewContext(FIT_SCRIPT, page.sandbox);
    const flush = async () => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    };

    await flush();
    expect(page.log).toEqual([]);
    expect(page.dataset).toEqual({});
    font.resolve();
    await flush();
    expect(page.log).toEqual([]);
    image.resolve();
    await page.sandbox.lzpFit;
    expect(page.log).toEqual(['--k=1']);
    expect(page.dataset.fit).toBe('done');
  });

  it('still reports when a font or an image failed to load (the runner fails the render for a font by name)', async () => {
    const page = fakePage({ blocks: TEXT, area: 1000 });
    const document = page.sandbox.document as {
      fonts: { load: () => Promise<void> }[];
      images: { decode: () => Promise<void> }[];
    };
    document.fonts[0] = { load: () => Promise.reject(new Error('font')) };
    document.images[0] = { decode: () => Promise.reject(new Error('image')) };
    runInNewContext(FIT_SCRIPT, page.sandbox);
    expect(await page.sandbox.lzpFit).toMatchObject({ fits: true });
  });

  it('uses no timer and no animation frame', () => {
    expect(FIT_SCRIPT).not.toMatch(
      /setTimeout|setInterval|requestAnimationFrame|requestIdleCallback/,
    );
  });

  it('needs no eval and no inline style: nothing the content policy would refuse', () => {
    expect(FIT_SCRIPT).not.toMatch(
      /\beval\b|new Function|setAttribute\(\s*['"]style|innerHTML|document\.write/,
    );
  });
});

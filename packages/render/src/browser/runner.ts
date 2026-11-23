import { readFile } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { z } from 'zod';
import { FONT_MANIFEST } from '../fonts/library.ts';
import { loadFonts } from '../fonts/load.ts';
import { SIZES, type SizeName } from '../sizes.ts';
import { contextOptions, LAUNCH_OPTIONS } from './flags.ts';
import {
  fallbacks,
  fontLoadFailure,
  manifestFamily,
  textBlocks,
  type BlockFonts,
  type FontFallback,
} from './fonts.ts';
import { RENDER_LIMITS, RenderFailure, slideBudget, withTimeout } from './limits.ts';
import { residentBytes } from './memory.ts';
import { BrowserCrashed, createBrowserPool } from './pool.ts';
import {
  assetIndex,
  findAsset,
  loggedUrl,
  PAGE_URL,
  servedHtml,
  type AssetIndex,
  type RenderAsset,
} from './requests.ts';

// The Chromium page runner (§08 Chrome in Docker, Security, Fonts): one browser per process, a fresh context per page,
// no network, fixed flags, limits, restarts and font checks. It returns the PNG master and what it measured; the fit
// report, the other formats and the `render` job are built on it.

export type Log = (
  event: string,
  fields?: Readonly<Record<string, string | number | boolean | undefined>>,
) => void;

/** The limits a renderer can be given (a post's 2 minutes come in as each page's `deadline`). */
export type RenderLimits = {
  slideMs: number;
  rendersPerBrowser: number;
  browserMemoryBytes: number;
};

export type RendererOptions = {
  /** Where blocked requests and crashes are logged: ids, codes and origin + path only (the worker's `log`). */
  log: Log;
  /** §08's limits by default; tests lower them. */
  limits?: Partial<RenderLimits>;
  /** Starts a render browser; `chromium.launch` with the fixed flags by default. Tests inject crashes through it. */
  launch?: () => Promise<Browser>;
  now?: () => number;
};

export type RenderPageInput = {
  /** A page from `buildSlide`, or any page: its requests, WebSockets and WebRTC reach no network either way. */
  html: string;
  /** The job's own images and uploaded fonts; the manifest fonts are always served. */
  assets: readonly RenderAsset[];
  size: SizeName;
  /** Logged with each blocked request. */
  jobId: string;
  /** When the post must be done (`postDeadline`); a slide gets what is left of it when that is less than its limit. */
  deadline?: number;
};

/** A request the page made that was not one of its assets: blocked, and named by origin and path only. */
export type BlockedRequest = { url: string; type: string };

export type RenderResult = {
  /** The PNG master: Chrome's lossless screenshot at 1×, in sRGB (§08 Outputs). */
  png: Uint8Array;
  width: number;
  height: number;
  /** The assets the page loaded, as `image/<key>` and `font/<sha256>`. */
  served: string[];
  blocked: BlockedRequest[];
  /** The fonts Chrome says drew each text block. */
  fonts: BlockFonts[];
  /** A font the page didn't load drew some of its text (§08 No silent fallbacks). */
  errors: FontFallback[];
};

export type Renderer = {
  renderPage: (input: RenderPageInput) => Promise<RenderResult>;
  /** Closes the browser, once the renders running on it finish. */
  close: () => Promise<void>;
};

// Runs in the page once it has loaded: loads every font it declares, waits for its images, and names the fonts that
// failed. A string, so the page's code needs no DOM types here; page.evaluate isn't bound by the page's content policy.
const SETTLE = `(async () => {
  const faces = [...document.fonts];
  await Promise.allSettled(faces.map((face) => face.load()));
  await document.fonts.ready;
  await Promise.allSettled([...document.images].map((image) => image.decode()));
  return faces
    .filter((face) => face.status === 'error')
    .map((face) => ({ family: face.family, weight: face.weight }));
})()`;

const FailedFonts = z.array(z.object({ family: z.string(), weight: z.string() }));

/** How long a render waits for its context to close after it ends. */
const CLOSE_MS = 2_000;

const CLOSED =
  /Target crashed|Page crashed|has been closed|Browser closed|browser has disconnected/i;

let manifestFonts: Promise<RenderAsset[]> | undefined;

/** The manifest's fonts as assets, read and checked once per process. */
function fontAssets(): Promise<RenderAsset[]> {
  manifestFonts ??= loadFonts(FONT_MANIFEST).then((fonts) =>
    fonts.flatMap((font) =>
      font.files.map((file): RenderAsset => ({
        kind: 'font',
        key: file.sha256,
        contentType: 'font/woff2',
        data: file.data,
      })),
    ),
  );
  manifestFonts.catch(() => {
    manifestFonts = undefined;
  });
  return manifestFonts;
}

/** The resident memory of all the browser's processes, from `/proc`; undefined where there is none. */
async function browserMemory(browser: Browser): Promise<number | undefined> {
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    return await residentBytes(
      processInfo.map((info) => info.id),
      (pid) => readFile(`/proc/${String(pid)}/status`, 'utf8'),
    );
  } finally {
    await session.detach().catch(() => undefined);
  }
}

/** Answers the page's requests: the page itself once, the job's assets, and nothing else. */
async function guard(
  context: BrowserContext,
  input: { html: string; index: AssetIndex; jobId: string; log: Log },
  facts: { served: string[]; blocked: BlockedRequest[] },
): Promise<void> {
  let pageServed = false;
  await context.route('**/*', async (route, request) => {
    const url = request.url();
    try {
      if (url === PAGE_URL && request.isNavigationRequest() && !pageServed) {
        pageServed = true;
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          headers: { 'cache-control': 'no-store' },
          body: input.html,
        });
        return;
      }
      // An asset is never a page: opened as a document (a frame, a link), an SVG's scripts would run on the page origin.
      const asset = request.isNavigationRequest() ? undefined : findAsset(input.index, url);
      if (asset !== undefined) {
        facts.served.push(`${asset.kind}/${asset.key}`);
        await route.fulfill({
          status: 200,
          contentType: asset.contentType,
          headers: { 'cache-control': 'no-store' },
          body: Buffer.from(asset.data),
        });
        return;
      }
      const blocked = { url: loggedUrl(url), type: request.resourceType() };
      facts.blocked.push(blocked);
      input.log('render.request_blocked', { jobId: input.jobId, ...blocked });
      await route.abort('blockedbyclient');
    } catch {
      // The context closed while the request was waiting: nothing is left to answer.
    }
  });
  // WebSockets don't pass through `route`: refuse every one, and log it like any other request.
  await context.routeWebSocket(/.*/, (socket) => {
    const blocked = { url: loggedUrl(socket.url()), type: 'websocket' };
    facts.blocked.push(blocked);
    input.log('render.request_blocked', { jobId: input.jobId, ...blocked });
    void socket.close({ code: 1008, reason: 'blocked' }).catch(() => undefined);
  });
}

const MANIFEST_FAMILIES = FONT_MANIFEST.fonts.map((font) => font.family);

/** The fonts Chrome used for each text block, from the DevTools protocol; a manifest font by its manifest family. */
async function usedFonts(context: BrowserContext, page: Page): Promise<BlockFonts[]> {
  const session = await context.newCDPSession(page);
  await session.send('DOM.enable');
  await session.send('CSS.enable');
  const { root } = await session.send('DOM.getDocument', { depth: -1 });
  const blocks: BlockFonts[] = [];
  for (const { nodeId, block } of textBlocks(root)) {
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
    blocks.push({
      block,
      fonts: fonts.map((font) => ({
        family: font.isCustomFont
          ? manifestFamily(font.familyName, MANIFEST_FAMILIES)
          : font.familyName,
        custom: font.isCustomFont,
        glyphs: font.glyphCount,
      })),
    });
  }
  await session.detach();
  return blocks;
}

async function draw(
  context: BrowserContext,
  input: { html: string; index: AssetIndex; jobId: string; size: SizeName; log: Log; ms: number },
  crashed: { page: boolean },
): Promise<RenderResult> {
  const facts = { served: [] as string[], blocked: [] as BlockedRequest[] };
  await guard(context, input, facts);
  const page = await context.newPage();
  page.on('crash', () => {
    crashed.page = true;
  });
  page.setDefaultTimeout(input.ms);
  page.setDefaultNavigationTimeout(input.ms);
  await page.goto(PAGE_URL, { waitUntil: 'load' });

  const failed = fontLoadFailure(FailedFonts.parse(await page.evaluate(SETTLE)));
  if (failed !== undefined) throw new RenderFailure(failed);

  const { width, height } = SIZES[input.size];
  const png = await page.screenshot({
    type: 'png',
    clip: { x: 0, y: 0, width, height },
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
  const fonts = await usedFonts(context, page);
  return {
    png: new Uint8Array(png),
    width,
    height,
    served: facts.served,
    blocked: facts.blocked,
    fonts,
    errors: fallbacks(fonts),
  };
}

/** Creates the process's renderer: its browser starts on the first render. Make one per worker process. */
export function createRenderer(options: RendererOptions): Renderer {
  const limits: RenderLimits = { ...RENDER_LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  const pool = createBrowserPool<Browser>({
    launch: options.launch ?? (() => chromium.launch(LAUNCH_OPTIONS)),
    close: (browser) => browser.close(),
    memoryBytes: browserMemory,
    rendersPerBrowser: limits.rendersPerBrowser,
    browserMemoryBytes: limits.browserMemoryBytes,
  });

  /** One try in `browser`, in its own context, closed after; a browser or page that died is a `BrowserCrashed`. */
  async function attempt(
    browser: Browser,
    input: { html: string; index: AssetIndex; jobId: string; size: SizeName },
    end: number,
    reason: string,
  ): Promise<RenderResult> {
    const ms = end - now();
    const crashed = { page: false };
    const state = { finished: false };
    let context: BrowserContext | undefined;
    const work = (async () => {
      const opened = await browser.newContext(contextOptions(input.size));
      if (state.finished) {
        await opened.close();
        throw new RenderFailure(reason);
      }
      context = opened;
      return draw(opened, { ...input, log: options.log, ms }, crashed);
    })();
    try {
      return await withTimeout(work, ms, reason);
    } catch (error) {
      const died =
        !browser.isConnected() ||
        crashed.page ||
        (!(error instanceof RenderFailure) && error instanceof Error && CLOSED.test(error.message));
      if (died) {
        options.log('render.browser_crashed', { jobId: input.jobId });
        throw new BrowserCrashed('The render browser or its page crashed');
      }
      if (error instanceof RenderFailure) throw error;
      throw new RenderFailure('The render browser failed on this slide', { cause: error });
    } finally {
      state.finished = true;
      // Closing a context whose page is stuck in a loop is waited for a short while only, so the render ends near its
      // limit; Chrome still tears the context down.
      if (context !== undefined)
        await withTimeout(context.close(), CLOSE_MS, 'close').catch(() => undefined);
    }
  }

  return {
    async renderPage(input) {
      const fonts = (await fontAssets()).filter(
        (font) => !input.assets.some((asset) => asset.kind === 'font' && asset.key === font.key),
      );
      const index = assetIndex([...input.assets, ...fonts]);
      const html = servedHtml(input.html);
      const start = now();
      const budget = slideBudget({
        now: start,
        deadline: input.deadline,
        slideMs: limits.slideMs,
      });
      const end = start + budget.ms;
      const page = { html, index, jobId: input.jobId, size: input.size };
      return pool.use((browser) => attempt(browser, page, end, budget.reason));
    },
    close: () => pool.close(),
  };
}

import { readFile } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { z } from 'zod';
import { contextOptions, LAUNCH_OPTIONS } from '../browser/flags.ts';
import { fontLoadFailure } from '../browser/fonts.ts';
import { RENDER_LIMITS, RenderFailure, slideBudget, withTimeout } from '../browser/limits.ts';
import { residentBytes } from '../browser/memory.ts';
import { BrowserCrashed, createBrowserPool } from '../browser/pool.ts';
import {
  assetIndex,
  findAsset,
  loggedUrl,
  PAGE_URL,
  servedHtml,
  type AssetIndex,
  type RenderAsset,
} from '../browser/requests.ts';
import type { Log } from '../browser/runner.ts';
import { FONT_MANIFEST } from '../fonts/library.ts';
import { loadFonts } from '../fonts/load.ts';
import { SIZES, type SizeName } from '../sizes.ts';
import { buildDocument, type DocumentInput } from './document.ts';

// The LinkedIn PDF's printer (§08 Outputs, Security): the document `buildDocument` makes, printed by the same pinned
// Chromium with the same flags and the same wall as the images: a fresh context per document, the page served once,
// only the job's assets and the manifest fonts answered, everything else blocked and logged. Each page is printed at
// the slide's size with no margins and with backgrounds, tagged, its fonts embedded (Chrome embeds the web fonts it
// draws with). The runner (`browser/runner.ts`) draws screenshots only; this is its PDF twin, built from its parts.

export type PrintInput = {
  /** A page from `buildDocument`, or any page: it reaches no network either way. */
  html: string;
  /** The job's own images (photos as their 1600 px copies, §08) and uploaded fonts; the manifest fonts are always served. */
  assets: readonly RenderAsset[];
  /** The one size of every page. */
  size: SizeName;
  /** Logged with each blocked request. */
  jobId: string;
  /** When the post must be done (`postDeadline`): the document gets what is left of it when that is less than its limit. */
  deadline?: number;
};

export type DocumentPrinter = {
  printPdf: (input: PrintInput) => Promise<Uint8Array>;
  /** Closes the browser, once the documents printing on it finish. */
  close: () => Promise<void>;
};

export type DocumentPrinterOptions = {
  /** Where blocked requests and crashes are logged: ids, codes and origin + path only (the worker's `log`). */
  log: Log;
  /** How long one document may take; a slide's 20 s by default (§08). */
  documentMs?: number;
  /** Starts the browser; `chromium.launch` with the fixed flags by default. */
  launch?: () => Promise<Browser>;
  /** Reads `/proc/<pid>/status` of one of the browser's processes, for its memory; `readFile` by default. */
  readProcessStatus?: (pid: number) => Promise<string>;
  now?: () => number;
};

// `SETTLE`, `fontAssets`, `browserMemory`, `guard` and `attempt` (with its timeout) below repeat the runner's
// (`browser/runner.ts`); the follow-up #357 gives the runner a print mode and drops this copy.

// Runs in the page once it has loaded: loads every font it declares, waits for its images, and names the fonts that
// failed (the runner's own settle step). A string, so the page's code needs no DOM types here.
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
async function browserMemory(
  browser: Browser,
  read: (pid: number) => Promise<string>,
): Promise<number | undefined> {
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    return await residentBytes(
      processInfo.map((info) => info.id),
      read,
    );
  } finally {
    await session.detach().catch(() => undefined);
  }
}

/** Answers the page's requests: the page itself once, the job's assets, and nothing else (WebSockets included). */
async function guard(
  context: BrowserContext,
  input: { html: string; index: AssetIndex; jobId: string; log: Log },
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
      // An asset is never a page: opened as a document, an SVG's scripts would run on the page origin.
      const asset = request.isNavigationRequest() ? undefined : findAsset(input.index, url);
      if (asset !== undefined) {
        await route.fulfill({
          status: 200,
          contentType: asset.contentType,
          headers: { 'cache-control': 'no-store' },
          body: Buffer.from(asset.data),
        });
        return;
      }
      input.log('render.request_blocked', {
        jobId: input.jobId,
        url: loggedUrl(url),
        type: request.resourceType(),
      });
      await route.abort('blockedbyclient');
    } catch {
      // The context closed while the request was waiting: nothing is left to answer.
    }
  });
  await context.routeWebSocket(/.*/, (socket) => {
    input.log('render.request_blocked', {
      jobId: input.jobId,
      url: loggedUrl(socket.url()),
      type: 'websocket',
    });
    void socket.close({ code: 1008, reason: 'blocked' }).catch(() => undefined);
  });
}

async function printIn(
  context: BrowserContext,
  input: { html: string; index: AssetIndex; jobId: string; size: SizeName; log: Log; ms: number },
  crashed: { page: boolean },
): Promise<Uint8Array> {
  await guard(context, input);
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
  const pdf = await page.pdf({
    // The document's own `@page` gives each page the slide's size; these say the same for a page that has none.
    width: `${String(width)}px`,
    height: `${String(height)}px`,
    preferCSSPageSize: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    printBackground: true,
    tagged: true,
    outline: false,
  });
  return new Uint8Array(pdf);
}

/** Creates the process's PDF printer: its browser starts on the first document. */
export function createDocumentPrinter(options: DocumentPrinterOptions): DocumentPrinter {
  const now = options.now ?? Date.now;
  const documentMs = options.documentMs ?? RENDER_LIMITS.slideMs;
  const readStatus =
    options.readProcessStatus ?? ((pid: number) => readFile(`/proc/${String(pid)}/status`, 'utf8'));
  const pool = createBrowserPool<Browser>({
    launch: options.launch ?? (() => chromium.launch(LAUNCH_OPTIONS)),
    close: (browser) => browser.close(),
    // Like the image browser, it restarts every 500 renders and whenever its memory passes the limit (§08).
    memoryBytes: (browser) => browserMemory(browser, readStatus),
    rendersPerBrowser: RENDER_LIMITS.rendersPerBrowser,
    browserMemoryBytes: RENDER_LIMITS.browserMemoryBytes,
  });

  async function attempt(
    browser: Browser,
    input: { html: string; index: AssetIndex; jobId: string; size: SizeName },
    end: number,
    reason: string,
  ): Promise<Uint8Array> {
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
      return printIn(opened, { ...input, log: options.log, ms }, crashed);
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
      throw new RenderFailure('The render browser failed to print the PDF', { cause: error });
    } finally {
      state.finished = true;
      if (context !== undefined)
        await withTimeout(context.close(), CLOSE_MS, 'close').catch(() => undefined);
    }
  }

  return {
    async printPdf(input) {
      const fonts = (await fontAssets()).filter(
        (font) => !input.assets.some((asset) => asset.kind === 'font' && asset.key === font.key),
      );
      const index = assetIndex([...input.assets, ...fonts]);
      const html = servedHtml(input.html);
      const start = now();
      const budget = slideBudget({ now: start, deadline: input.deadline, slideMs: documentMs });
      const reason = budget.reason.replace('The slide didn’t', 'The PDF didn’t');
      const page = { html, index, jobId: input.jobId, size: input.size };
      return pool.use((browser) => attempt(browser, page, start + budget.ms, reason));
    },
    close: () => pool.close(),
  };
}

/**
 * The LinkedIn PDF of `post` (§08 Outputs): every slide at `size`, one page each, at the `k` of its fit report, titled
 * with the hook, printed by `printer`. Throws before printing when the reports or the title are wrong
 * (`buildDocument`).
 */
export async function renderDocument(
  printer: DocumentPrinter,
  input: DocumentInput & { assets: readonly RenderAsset[]; jobId: string; deadline?: number },
): Promise<Uint8Array> {
  const { post, size, kit, reports, title, assets, jobId, deadline } = input;
  const html = buildDocument({ post, size, kit, reports, title });
  return printer.printPdf({
    html,
    assets,
    size,
    jobId,
    ...(deadline === undefined ? {} : { deadline }),
  });
}

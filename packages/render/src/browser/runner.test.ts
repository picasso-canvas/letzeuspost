import type { Browser } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { RenderFailure } from './limits.ts';
import { PAGE_ORIGIN, PAGE_URL, type RenderAsset } from './requests.ts';
import { createRenderer, pageFit, type RenderPageInput } from './runner.ts';

describe('pageFit: what the page’s fit script reported', () => {
  it('is nothing for a page without a fit script', () => {
    expect(pageFit(undefined)).toBeUndefined();
    expect(pageFit(null)).toBeUndefined();
  });

  it('is the report of a page that fits', () => {
    expect(pageFit({ k: 0.9, fits: true, fields: [] })).toEqual({ k: 0.9, fits: true, fields: [] });
  });

  it('keeps the blocks to shorten of a page that does not fit', () => {
    const fields = [{ name: 'title', lines: 5, needed: 500, available: 250, overflowPx: 250 }];
    expect(pageFit({ k: 0.85, fits: false, fields })).toEqual({ k: 0.85, fits: false, fields });
  });

  it('fails the render for a result the fit script could not have made', () => {
    expect(() => pageFit({ k: 3, fits: true, fields: [] })).toThrow(RenderFailure);
    expect(() => pageFit('done')).toThrow(RenderFailure);
  });
});

// The one request filter (§08 Security: the render browser has no internet), driven by fake browsers in both of the
// runner's modes: the image (a screenshot) and the print (a PDF). The fake page's load makes the same requests in each.

type Answer =
  | { url: string; answer: 'fulfilled'; contentType: string }
  | { url: string; answer: 'aborted'; code: string }
  | { url: string; answer: 'closed'; code: number };

type FakeRequest = { url: string; navigation: boolean; type: string };

const LOGO: RenderAsset = {
  kind: 'image',
  key: 'logo_light_1',
  contentType: 'image/png',
  data: new Uint8Array([1, 2, 3]),
};

const REQUESTS: readonly FakeRequest[] = [
  { url: PAGE_URL, navigation: true, type: 'document' },
  { url: `${PAGE_ORIGIN}/image/logo_light_1`, navigation: false, type: 'image' },
  { url: 'https://leak.example/pixel.png?user=someone', navigation: false, type: 'image' },
  // An asset opened as a document (a frame), and the page loaded a second time: neither is answered.
  { url: `${PAGE_ORIGIN}/image/logo_light_1`, navigation: true, type: 'document' },
  { url: PAGE_URL, navigation: true, type: 'document' },
];

type RouteHandler = (
  route: {
    fulfill: (response: { contentType: string }) => Promise<void>;
    abort: (code: string) => Promise<void>;
  },
  request: { url: () => string; isNavigationRequest: () => boolean; resourceType: () => string },
) => Promise<void>;

type SocketHandler = (socket: {
  url: () => string;
  close: (options: { code: number }) => Promise<void>;
}) => void;

/** A fake Playwright browser whose page, on load, sends `REQUESTS` and one WebSocket through the context's filter. */
function fakeBrowser(answers: Answer[]): () => Promise<Browser> {
  let routed: RouteHandler | undefined;
  let sockets: SocketHandler | undefined;
  const load = async () => {
    for (const { url, navigation, type } of REQUESTS)
      await routed?.(
        {
          fulfill: (response) => {
            answers.push({ url, answer: 'fulfilled', contentType: response.contentType });
            return Promise.resolve();
          },
          abort: (code) => {
            answers.push({ url, answer: 'aborted', code });
            return Promise.resolve();
          },
        },
        { url: () => url, isNavigationRequest: () => navigation, resourceType: () => type },
      );
    const socket = 'wss://leak.example/socket?token=secret';
    sockets?.({
      url: () => socket,
      close: ({ code }) => {
        answers.push({ url: socket, answer: 'closed', code });
        return Promise.resolve();
      },
    });
    return null;
  };
  const page = {
    on: () => undefined,
    setDefaultTimeout: () => undefined,
    setDefaultNavigationTimeout: () => undefined,
    goto: load,
    evaluate: (script: string) => Promise.resolve(script === 'window.lzpFit' ? undefined : []),
    screenshot: () => Promise.resolve(Buffer.from('png')),
    pdf: () => Promise.resolve(Buffer.from('%PDF-')),
  };
  const session = {
    send: (method: string) =>
      Promise.resolve(
        method === 'DOM.getDocument'
          ? { root: { nodeId: 1, nodeType: 9, children: [] } }
          : { fonts: [], processInfo: [] },
      ),
    detach: () => Promise.resolve(),
  };
  const context = {
    route: (_: string, handler: RouteHandler) => {
      routed = handler;
      return Promise.resolve();
    },
    routeWebSocket: (_: RegExp, handler: SocketHandler) => {
      sockets = handler;
      return Promise.resolve();
    },
    newPage: () => Promise.resolve(page),
    newCDPSession: () => Promise.resolve(session),
    close: () => Promise.resolve(),
  };
  const browser = {
    newContext: () => Promise.resolve(context),
    isConnected: () => true,
    close: () => Promise.resolve(),
    newBrowserCDPSession: () => Promise.resolve(session),
  };
  return () => Promise.resolve(browser as unknown as Browser);
}

type Logged = { event: string; fields: unknown }[];

/** What the filter answered and logged for one page drawn in `mode`. */
async function filtered(mode: 'image' | 'print'): Promise<{ answers: Answer[]; logged: Logged }> {
  const answers: Answer[] = [];
  const logged: Logged = [];
  const renderer = createRenderer({
    log: (event, fields) => {
      logged.push({ event, fields });
    },
    launch: fakeBrowser(answers),
  });
  const input: RenderPageInput = {
    html: '<p>Pitha</p>',
    assets: [LOGO],
    size: 'square',
    jobId: 'job-1',
  };
  try {
    if (mode === 'image') await renderer.renderPage(input);
    else await renderer.printPage(input);
  } finally {
    await renderer.close();
  }
  return { answers, logged };
}

describe('the runner’s modes: one request filter serves the image and the print', () => {
  it('answers the page once and the job’s assets, and blocks and logs the rest, in both modes alike', async () => {
    const image = await filtered('image');
    const print = await filtered('print');
    expect(print).toEqual(image);
    expect(image.answers).toEqual([
      { url: PAGE_URL, answer: 'fulfilled', contentType: 'text/html; charset=utf-8' },
      { url: `${PAGE_ORIGIN}/image/logo_light_1`, answer: 'fulfilled', contentType: 'image/png' },
      {
        url: 'https://leak.example/pixel.png?user=someone',
        answer: 'aborted',
        code: 'blockedbyclient',
      },
      { url: `${PAGE_ORIGIN}/image/logo_light_1`, answer: 'aborted', code: 'blockedbyclient' },
      { url: PAGE_URL, answer: 'aborted', code: 'blockedbyclient' },
      { url: 'wss://leak.example/socket?token=secret', answer: 'closed', code: 1008 },
    ]);
    const blocked = (url: string, type: string) => ({
      event: 'render.request_blocked',
      fields: { jobId: 'job-1', url, type },
    });
    expect(image.logged).toEqual([
      blocked('https://leak.example/pixel.png', 'image'),
      blocked(`${PAGE_ORIGIN}/image/logo_light_1`, 'document'),
      blocked(PAGE_URL, 'document'),
      blocked('wss://leak.example/socket', 'websocket'),
    ]);
  });

  it('prints the page as the PDF Chrome makes', async () => {
    const renderer = createRenderer({ log: () => undefined, launch: fakeBrowser([]) });
    try {
      const pdf = await renderer.printPage({
        html: '<p>Pitha</p>',
        assets: [],
        size: 'square',
        jobId: 'job-1',
      });
      expect(Buffer.from(pdf).toString('latin1')).toBe('%PDF-');
    } finally {
      await renderer.close();
    }
  });
});

import type { Post } from '@lzp/core';
import type { Browser } from 'playwright-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { RENDER_LIMITS } from '../browser/limits.ts';
import type { RenderAsset } from '../browser/requests.ts';
import type { FitReport } from '../fit/report.ts';
import { registerLook } from '../page/looks.ts';
import { TEST_LOOK, testKit, testPost, testSlide } from '../page/test-fixtures.ts';
import { buildDocument } from './document.ts';
import {
  createDocumentPrinter,
  renderDocument,
  type DocumentPrinter,
  type PrintInput,
} from './pdf.ts';

// `renderDocument` hands the printer the document `buildDocument` makes, with the job's assets; the printer itself
// (Chrome, no network) is checked in a real browser by tests/render/outputs.spec.ts.

beforeAll(() => {
  registerLook(TEST_LOOK);
});

const post = (): Post =>
  testPost(testSlide(), {
    kind: 'document',
    networks: ['linkedin'],
    slides: [testSlide(), testSlide({ title: 'Come taste it' })],
  });

const reports: FitReport[] = [1, 2].map((slide) => ({
  size: 'square',
  slide,
  k: slide === 1 ? 1 : 0.9,
  status: 'pass',
  fields: [],
}));

const LOGO: RenderAsset = {
  kind: 'image',
  key: 'logo_light_1',
  contentType: 'image/png',
  data: new Uint8Array([1, 2, 3]),
};

const PDF = new TextEncoder().encode('%PDF-1.4');

/** A printer that keeps what it was given and answers with fixed bytes. */
function recorder(): DocumentPrinter & { printed: PrintInput[] } {
  const printed: PrintInput[] = [];
  return {
    printed,
    printPdf: (input) => {
      printed.push(input);
      return Promise.resolve(PDF);
    },
    close: () => Promise.resolve(),
  };
}

describe('renderDocument', () => {
  it('prints buildDocument’s document at the size, with the job’s assets, and returns the PDF', async () => {
    const printer = recorder();
    const document = post();
    const pdf = await renderDocument(printer, {
      post: document,
      size: 'square',
      kit: testKit(),
      reports,
      title: 'Pitha is older than tea',
      assets: [LOGO],
      jobId: 'job-1',
      deadline: 5_000,
    });
    expect(pdf).toBe(PDF);
    expect(printer.printed).toEqual([
      {
        html: buildDocument({
          post: document,
          size: 'square',
          kit: testKit(),
          reports,
          title: 'Pitha is older than tea',
        }),
        assets: [LOGO],
        size: 'square',
        jobId: 'job-1',
        deadline: 5_000,
      },
    ]);
  });

  it('prints nothing when the fit reports don’t match the slides', async () => {
    const printer = recorder();
    await expect(
      renderDocument(printer, {
        post: post(),
        size: 'square',
        kit: testKit(),
        reports: reports.slice(0, 1),
        title: 'Pitha',
        assets: [],
        jobId: 'job-1',
      }),
    ).rejects.toThrow(/fit report/);
    expect(printer.printed).toEqual([]);
  });
});

/** Fake Playwright browsers that print fixed bytes and report two processes, with a count of launches and closes. */
function fakeBrowsers(): { launch: () => Promise<Browser>; launched: number; closed: number } {
  const page = {
    on: () => undefined,
    setDefaultTimeout: () => undefined,
    setDefaultNavigationTimeout: () => undefined,
    goto: () => Promise.resolve(null),
    evaluate: () => Promise.resolve([]),
    pdf: () => Promise.resolve(Buffer.from(PDF)),
  };
  const context = {
    route: () => Promise.resolve(),
    routeWebSocket: () => Promise.resolve(),
    newPage: () => Promise.resolve(page),
    close: () => Promise.resolve(),
  };
  const counts = {
    launched: 0,
    closed: 0,
    launch: () => {
      counts.launched += 1;
      const browser = {
        newContext: () => Promise.resolve(context),
        isConnected: () => true,
        close: () => {
          counts.closed += 1;
          return Promise.resolve();
        },
        newBrowserCDPSession: () =>
          Promise.resolve({
            send: () => Promise.resolve({ processInfo: [{ id: 101 }, { id: 102 }] }),
            detach: () => Promise.resolve(),
          }),
      };
      return Promise.resolve(browser as unknown as Browser);
    },
  };
  return counts;
}

/** `/proc/<pid>/status` of a process holding `kb` kilobytes. */
const status = (kb: number) => (): Promise<string> =>
  Promise.resolve(`Name:\tchrome\nVmRSS:\t${String(kb)} kB\nThreads:\t9\n`);

const print = (printer: DocumentPrinter, jobId: string) =>
  printer.printPdf({ html: '<p>Pitha</p>', assets: [], size: 'square', jobId });

describe('createDocumentPrinter: the PDF browser’s restarts (§08)', () => {
  const limitKb = RENDER_LIMITS.browserMemoryBytes / 1024;

  it('prints the next document on a new browser once the browser’s memory passes its limit', async () => {
    const browsers = fakeBrowsers();
    // Two processes, each a little over half the limit: together they pass it.
    const printer = createDocumentPrinter({
      log: () => undefined,
      launch: browsers.launch,
      readProcessStatus: status(limitKb / 2 + 1),
    });
    expect(await print(printer, 'job-1')).toEqual(PDF);
    expect(browsers.closed).toBe(1);
    expect(await print(printer, 'job-2')).toEqual(PDF);
    expect(browsers.launched).toBe(2);
    await printer.close();
  });

  it('keeps printing on the same browser while its memory is under the limit', async () => {
    const browsers = fakeBrowsers();
    const printer = createDocumentPrinter({
      log: () => undefined,
      launch: browsers.launch,
      readProcessStatus: status(limitKb / 2 - 1),
    });
    await print(printer, 'job-1');
    await print(printer, 'job-2');
    expect(browsers.launched).toBe(1);
    expect(browsers.closed).toBe(0);
    await printer.close();
  });
});

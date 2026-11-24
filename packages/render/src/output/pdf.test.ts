import type { Post } from '@lzp/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RenderAsset } from '../browser/requests.ts';
import type { FitReport } from '../fit/report.ts';
import { registerLook } from '../page/looks.ts';
import { TEST_LOOK, testKit, testPost, testSlide } from '../page/test-fixtures.ts';
import { buildDocument } from './document.ts';
import { renderDocument, type DocumentPrinter, type PrintInput } from './pdf.ts';

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

import type { Browser } from 'playwright-core';
import type { RenderAsset } from '../browser/requests.ts';
import { createRenderer, type Log } from '../browser/runner.ts';
import type { SizeName } from '../sizes.ts';
import { buildDocument, type DocumentInput } from './document.ts';

// The LinkedIn PDF's printer (§08 Outputs, Security): the document `buildDocument` makes, printed by the runner's print
// mode (`browser/runner.ts`), so behind the same pinned Chromium, flags and request filter as the images: a fresh
// context per document, the page served once, only the job's assets and the manifest fonts answered, everything else
// blocked and logged. The printer keeps a browser of its own, restarted like the image browser (§08).

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

/** Creates the process's PDF printer: its browser starts on the first document. */
export function createDocumentPrinter(options: DocumentPrinterOptions): DocumentPrinter {
  const { documentMs, ...runner } = options;
  const renderer = createRenderer({
    ...runner,
    ...(documentMs === undefined ? {} : { limits: { slideMs: documentMs } }),
  });
  return { printPdf: (input) => renderer.printPage(input), close: () => renderer.close() };
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

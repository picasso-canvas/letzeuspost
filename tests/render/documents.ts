import type { Post, SizeName } from '../../packages/core/src/index.ts';
import type { Log, RenderAsset } from '../../packages/render/src/browser/index.ts';
import type { FitReport } from '../../packages/render/src/fit/report.ts';
import type { RenderKit } from '../../packages/render/src/kit.ts';
import { testKit } from '../../packages/render/src/page/test-fixtures.ts';

// The LinkedIn PDF's printer for the render specs, from the render package's `@lzp/render/output` entry. Its document is
// built by React, whose types only the render package has (`page/react-types.d.ts`, which the root typecheck can't
// load), so the entry is imported here by a computed path and given the type it has there, as `slides.ts` does; the
// render package's typecheck and tests cover it.

/** The render package's `DocumentPrinter`. */
export type DocumentPrinter = {
  printPdf: (input: {
    html: string;
    assets: readonly RenderAsset[];
    size: SizeName;
    jobId: string;
  }) => Promise<Uint8Array>;
  close: () => Promise<void>;
};

type Output = {
  createDocumentPrinter: (options: { log: Log }) => DocumentPrinter;
  renderDocument: (
    printer: DocumentPrinter,
    input: {
      post: Post;
      size: SizeName;
      kit: RenderKit;
      reports: readonly FitReport[];
      title: string;
      assets: readonly RenderAsset[];
      jobId: string;
    },
  ) => Promise<Uint8Array>;
};

const LOOKS = new URL('../../packages/render/src/looks/index.ts', import.meta.url).href;
const OUTPUT = new URL('../../packages/render/src/output/index.ts', import.meta.url).href;

let output: Promise<Output> | undefined;

/** The output entry, once every look has registered itself. */
function loadOutput(): Promise<Output> {
  output ??= import(LOOKS).then(() => import(OUTPUT) as Promise<Output>);
  return output;
}

/** A PDF printer with no network, from the render package. */
export async function documentPrinter(log: Log): Promise<DocumentPrinter> {
  return (await loadOutput()).createDocumentPrinter({ log });
}

/** `renderDocument` from the render package: the post's slides at `size`, in the test kit unless given another. */
export async function printPost(
  printer: DocumentPrinter,
  input: {
    post: Post;
    size: SizeName;
    reports: readonly FitReport[];
    title: string;
    assets: readonly RenderAsset[];
    kit?: RenderKit;
  },
): Promise<Uint8Array> {
  const { renderDocument } = await loadOutput();
  return renderDocument(printer, { kit: testKit(), jobId: 'job-pdf', ...input });
}

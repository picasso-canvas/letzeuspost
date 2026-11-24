import type { RenderAsset } from '../browser/requests.ts';
import type { SizeName } from '../sizes.ts';
import type { DocumentInput } from './document.ts';

export type PrintInput = {
  html: string;
  assets: readonly RenderAsset[];
  size: SizeName;
  jobId: string;
  deadline?: number;
};

export type DocumentPrinter = {
  printPdf: (input: PrintInput) => Promise<Uint8Array>;
  close: () => Promise<void>;
};

export function renderDocument(
  _printer: DocumentPrinter,
  _input: DocumentInput & { assets: readonly RenderAsset[]; jobId: string; deadline?: number },
): Promise<Uint8Array> {
  return Promise.resolve(new Uint8Array());
}

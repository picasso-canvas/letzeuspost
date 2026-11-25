// Reading an uploaded PDF (§06 Reading uploaded files). Not written yet: the tests come first.
export type PdfRefusalReason =
  'not-a-pdf' | 'unreadable' | 'locked' | 'too-many-pages' | 'no-text' | 'too-slow';

export class PdfRefusedError extends Error {
  override readonly name = 'PdfRefusedError';
  readonly reason: PdfRefusalReason;
  constructor(reason: PdfRefusalReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export const MAX_PDF_PAGES = 100;
export const MAX_PDF_TEXT_CHARS = 1_000_000;

export function isPdf(_bytes: Uint8Array): boolean {
  return false;
}

export function readPdfText(
  _bytes: Uint8Array,
  _options: { seconds?: number } = {},
): Promise<{ text: string; pages: number }> {
  return Promise.resolve({ text: '', pages: 0 });
}

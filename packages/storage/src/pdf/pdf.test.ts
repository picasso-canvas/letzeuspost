// Reading an uploaded PDF (§06 Reading uploaded files: "PDFs are read as text"; #402): its text only, never drawn, at
// most 100 pages, within 15 seconds, and refused with a plain reason when it can't be read. The fixtures (./fixtures.ts)
// are built from bytes, so what each hostile one does is visible.
import { describe, expect, it } from 'vitest';
import {
  banglaPdf,
  bombPdf,
  drawingOnlyPdf,
  lockedPdf,
  loopingPdf,
  pageCountLiePdf,
  scriptedPdf,
  textPdf,
} from './fixtures.ts';
import {
  isPdf,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_CHARS,
  PdfRefusedError,
  readPdfText,
  type PdfRefusalReason,
} from './pdf.ts';

/** The reason `readPdfText` refused the file with; fails the test if it read it. */
async function refusal(
  pdf: Uint8Array,
  options?: { seconds?: number },
): Promise<{ reason: PdfRefusalReason; message: string }> {
  try {
    await readPdfText(pdf, options);
  } catch (error) {
    if (error instanceof PdfRefusedError) return { reason: error.reason, message: error.message };
    throw error;
  }
  throw new Error('expected the PDF to be refused, and it was read');
}

describe('isPdf', () => {
  it('knows a PDF by its first bytes, not by anything it claims later', () => {
    expect(isPdf(textPdf(['Menu']))).toBe(true);
    expect(isPdf(new TextEncoder().encode('%PDF-'))).toBe(true);
    expect(isPdf(new TextEncoder().encode('\n%PDF-1.7'))).toBe(false);
    expect(isPdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isPdf(new Uint8Array())).toBe(false);
  });
});

describe('readPdfText', () => {
  it('reads the text of every page, in order, one page after another', async () => {
    const pdf = textPdf(['Golpo Cafe menu\nTea 40 taka', 'Open every day (10 am to 10 pm)']);
    const read = await readPdfText(pdf);
    expect(read.pages).toBe(2);
    expect(read.text).toBe('Golpo Cafe menu\nTea 40 taka\n\nOpen every day (10 am to 10 pm)');
  });

  it('reads Bangla through the font’s own character map', async () => {
    expect((await readPdfText(banglaPdf())).text).toBe('বাংলা');
  });

  it(`reads ${String(MAX_PDF_PAGES)} pages, and refuses one more`, async () => {
    const pages = (n: number) => Array.from({ length: n }, (_, i) => `Page ${String(i + 1)}`);
    const longest = await readPdfText(textPdf(pages(MAX_PDF_PAGES)));
    expect(longest.pages).toBe(MAX_PDF_PAGES);
    expect(longest.text.split('\n\n').at(-1)).toBe(`Page ${String(MAX_PDF_PAGES)}`);
    expect(await refusal(textPdf(pages(MAX_PDF_PAGES + 1)))).toEqual({
      reason: 'too-many-pages',
      message: 'This PDF is too long: at most 100 pages.',
    });
  });

  it('keeps at most a million characters of text, and stops reading there', async () => {
    // 500 lines of 900 characters a page, in 1-point type so every line is on the page.
    const page = Array.from({ length: 500 }, () => 'a'.repeat(900)).join('\n');
    const pdf = textPdf([page, page, page, 'never reached'], { size: 1 });
    const read = await readPdfText(pdf);
    expect(read.text).toHaveLength(MAX_PDF_TEXT_CHARS);
    expect(read.text.startsWith(`${'a'.repeat(900)}\n`)).toBe(true);
    expect(read.text).not.toContain('never reached');
  });

  it('refuses a PDF with no text to read', async () => {
    expect(await refusal(drawingOnlyPdf())).toEqual({
      reason: 'no-text',
      message:
        'This PDF has no text we can read. If it is scanned, please upload its pages as images.',
    });
    expect((await refusal(textPdf([' \n ']))).reason).toBe('no-text');
  });

  it('refuses a file that is not a PDF, or that breaks off', async () => {
    expect(await refusal(new TextEncoder().encode('Menu: tea 40 taka'))).toEqual({
      reason: 'not-a-pdf',
      message: "That file isn't a PDF.",
    });
    expect(await refusal(new TextEncoder().encode('%PDF-1.7\n%%EOF'))).toEqual({
      reason: 'unreadable',
      message: "This PDF couldn't be read. Please save it again as a PDF and upload it.",
    });
  });

  it('refuses a PDF locked with a password', async () => {
    expect(await refusal(lockedPdf())).toEqual({
      reason: 'locked',
      message: 'This PDF is protected by a password. Please upload a copy without one.',
    });
  });

  describe('hostile PDFs', () => {
    it('counts the pages a tree holds, not the million it claims', async () => {
      const started = Date.now();
      expect(await readPdfText(pageCountLiePdf())).toEqual({
        pages: 1,
        text: 'Only one page here.',
      });
      expect(Date.now() - started).toBeLessThan(5_000);
    });

    it('comes back from a page tree and a cross-reference chain that loop', async () => {
      const started = Date.now();
      expect(['unreadable', 'no-text']).toContain((await refusal(loopingPdf())).reason);
      expect(Date.now() - started).toBeLessThan(5_000);
    });

    it('reads only the page text: never a script or an attached file', async () => {
      const read = await readPdfText(scriptedPdf('Price list 2026'));
      expect(read.text).toBe('Price list 2026');
    });

    it('stops at the time limit: a content stream that inflates to 300 MB is cut off and refused', async () => {
      const started = Date.now();
      expect(await refusal(bombPdf(300), { seconds: 1 })).toEqual({
        reason: 'too-slow',
        message: 'This PDF took too long to read. Please save it again as a simpler PDF.',
      });
      expect(Date.now() - started).toBeLessThan(4_000);
    }, 30_000);

    it('takes a time limit of whole seconds from 1 to 60 only', async () => {
      const pdf = textPdf(['Menu']);
      for (const seconds of [0, 0.5, 61, Number.NaN]) {
        await expect(readPdfText(pdf, { seconds })).rejects.toThrow(RangeError);
      }
    });
  });
});

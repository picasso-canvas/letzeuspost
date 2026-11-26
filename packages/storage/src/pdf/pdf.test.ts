// Reading an uploaded PDF (§06 Reading uploaded files: "PDFs are read as text"; #402): its text only, never drawn, at
// most 100 pages, within 15 seconds, and refused with a plain reason when it can't be read. The fixtures (./fixtures.ts)
// are built from bytes, so what each hostile one does is visible.
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  banglaPdf,
  bombPdf,
  drawingOnlyPdf,
  lockedPdf,
  loopingPdf,
  pageCountLiePdf,
  postScriptFunctionPdf,
  scriptedPdf,
  textPdf,
} from './fixtures.ts';
import {
  isPdf,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_CHARS,
  MAX_READER_MEMORY_MB,
  PDF_TIME_LIMIT_SECONDS,
  PdfRefusedError,
  readerFlags,
  readPdfText,
  type PdfRefusalReason,
} from './pdf.ts';

/** The reason `readPdfText` refused the file with; fails the test if it read it. */
async function refusal(
  pdf: Uint8Array,
  options?: { seconds?: number; memoryMb?: number },
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

  it('refuses a PDF over 20 MB (§06) before reading any of it', async () => {
    expect(MAX_PDF_BYTES).toBe(20 * 1024 * 1024);
    const small = textPdf(['Menu']);
    // A real PDF, padded past the cap with a comment after its end: only its size can refuse it.
    const large = new Uint8Array(MAX_PDF_BYTES + 1);
    large.set(small);
    large.fill(0x25, small.length);
    expect(await refusal(large)).toEqual({
      reason: 'too-large',
      message: 'This PDF is too large: at most 20 MB.',
    });
    const atTheCap = new Uint8Array(MAX_PDF_BYTES);
    atTheCap.set(small);
    atTheCap.fill(0x0a, small.length);
    expect((await readPdfText(atTheCap)).text).toBe('Menu');
  }, 30_000);

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

    it('caps the memory the reader holds, buffers included: content inflating to 1.2 GB is refused long before the time limit', async () => {
      expect(MAX_READER_MEMORY_MB).toBe(1024);
      const bomb = bombPdf(1200);
      const started = Date.now();
      // The full 15 seconds: only the memory cap can stop it this soon.
      expect(await refusal(bomb, { seconds: PDF_TIME_LIMIT_SECONDS })).toEqual({
        reason: 'too-much-memory',
        message: 'This PDF needs too much memory to read. Please save it again as a simpler PDF.',
      });
      expect(Date.now() - started).toBeLessThan(8_000);
    }, 60_000);

    it('takes a memory cap of whole megabytes from 1 to 4096 only', async () => {
      const pdf = textPdf(['Menu']);
      for (const memoryMb of [0, 0.5, 4097, Number.NaN]) {
        await expect(readPdfText(pdf, { memoryMb })).rejects.toThrow(RangeError);
      }
    });

    it('carries on when the reader ends before it has taken the whole PDF in (its broken pipe is not an error)', async () => {
      // A 1 MB cap ends the reader before it reads its input, so writing 20 MB to it breaks the pipe mid-write.
      const pdf = new Uint8Array(MAX_PDF_BYTES).fill(0x0a);
      pdf.set(textPdf(['Menu']));
      expect((await refusal(pdf, { memoryMb: 1 })).reason).toBe('too-much-memory');
    }, 30_000);

    it('reads a PDF holding PostScript (Type 4) functions as its text only', async () => {
      expect(await readPdfText(postScriptFunctionPdf('Spot colour price list'))).toEqual({
        pages: 1,
        text: 'Spot colour price list',
      });
    });
  });
});

describe('the reader process', () => {
  it('may read only its own code and pdf.js, start no process, write no file and compile no string', () => {
    const flags = readerFlags(MAX_READER_MEMORY_MB);
    // This package's folder, and pdf.js's own (its main file is build/pdf.mjs), as the file system has them.
    const storage = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
    const pdfjs = realpathSync(
      dirname(dirname(createRequire(import.meta.url).resolve('pdfjs-dist'))),
    );
    expect(flags.filter((flag) => flag.startsWith('--'))).toEqual([
      '--permission',
      `--allow-fs-read=${storage}${sep}`,
      `--allow-fs-read=${pdfjs}${sep}`,
      // The memory cap is a thread of the reader's own (./memory-cap.ts).
      '--allow-worker',
      '--disallow-code-generation-from-strings',
      '--max-old-space-size=512',
    ]);
  });
});

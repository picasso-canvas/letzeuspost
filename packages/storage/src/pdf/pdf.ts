// Reading an uploaded PDF (§06 Reading uploaded files: "PDFs are read as text"; #402). A PDF is untrusted, like any
// upload (§10, §13 Security summary), so it gets the walls an SVG gets (../images.ts):
// - its type comes from its first bytes (`%PDF-`), never its name or the type the browser sent;
// - it is read by pdf.js (pdfjs-dist, Apache-2.0, pinned) in a process of its own (./read-pdf-text.ts) that gets no
//   environment, may write at most what the text cap needs, is killed at the time limit (15 s, Athena's reading of
//   §10's "5–15 s a photo") or once it holds more than 1 GB of memory (./memory-cap.ts), and under Node's permission
//   model may read only its own code and pdf.js, write no file, start no process and compile no string to code, so a
//   crafted file can't hold the worker, starve it of memory, or reach its secrets;
// - only its text is read: no page is drawn, no script run, nothing fetched; fonts are parsed for their character maps
//   only; none is drawn or installed;
// - at most 20 MB (§06), checked before the reader starts;
// - at most 100 pages (Athena, #402), counted from the file's page tree before any page is read, and at most a million
//   characters of text are kept (about 200 pages of dense text; a cap of this package's, so one file can't fill a row).
// A PDF that is too large, can't be read, is locked, is too long, too slow, needs too much memory, or holds no text is
// refused with a `PdfRefusedError`, whose message is safe to show to the person who sent it and holds nothing of the file.
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type PdfRefusalReason =
  | 'not-a-pdf'
  | 'too-large'
  | 'unreadable'
  | 'locked'
  | 'too-many-pages'
  | 'no-text'
  | 'too-slow'
  | 'too-much-memory';

export class PdfRefusedError extends Error {
  override readonly name = 'PdfRefusedError';
  readonly reason: PdfRefusalReason;
  constructor(reason: PdfRefusalReason) {
    super(MESSAGES[reason]);
    this.reason = reason;
  }
}

/** The largest PDF that is read: §06's "up to 20 MB each". */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
/** The most pages a PDF may have (Athena, #402). */
export const MAX_PDF_PAGES = 100;
/** How long reading a PDF may take before it is refused (Athena, #402). */
export const PDF_TIME_LIMIT_SECONDS = 15;
/** The most characters of a PDF's text that are kept; the rest is left unread. */
export const MAX_PDF_TEXT_CHARS = 1_000_000;
/**
 * The most resident memory the reader process may hold, in megabytes: about ten times what pdf.js needs for the text
 * of a 20 MB, 100-page PDF, and far below what a decompression bomb reaches within the time limit.
 */
export const MAX_READER_MEMORY_MB = 1024;

const MESSAGES: Readonly<Record<PdfRefusalReason, string>> = {
  'not-a-pdf': "That file isn't a PDF.",
  'too-large': 'This PDF is too large: at most 20 MB.',
  unreadable: "This PDF couldn't be read. Please save it again as a PDF and upload it.",
  locked: 'This PDF is protected by a password. Please upload a copy without one.',
  'too-many-pages': `This PDF is too long: at most ${String(MAX_PDF_PAGES)} pages.`,
  'no-text':
    'This PDF has no text we can read. If it is scanned, please upload its pages as images.',
  'too-slow': 'This PDF took too long to read. Please save it again as a simpler PDF.',
  'too-much-memory':
    'This PDF needs too much memory to read. Please save it again as a simpler PDF.',
};

const SIGNATURE = Buffer.from('%PDF-', 'latin1');

/** Whether the bytes start as a PDF does. A file that only says so later (after an image, say) is not one. */
export function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .subarray(0, SIGNATURE.length)
    .equals(SIGNATURE);
}

const READER = fileURLToPath(new URL('./read-pdf-text.ts', import.meta.url));
// The answer is JSON: each character of text takes at most 6 bytes there (`\u0000`).
const MAX_ANSWER_BYTES = MAX_PDF_TEXT_CHARS * 6 + 1_000;
// V8's heap only: pdf.js's objects, which stay well within this (past it V8 aborts the process, and the PDF is refused
// as unreadable). The typed arrays a stream inflates into are outside the heap; the memory cap counts those.
const MAX_HEAP_MB = 512;

// What the reader may read, as the file system names it (the permission model checks real paths): this package, which
// holds the reader and its memory cap, and pdf.js, whose main file is `build/pdf.mjs`.
const STORAGE_DIR = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const PDFJS_DIR = realpathSync(
  dirname(dirname(createRequire(import.meta.url).resolve('pdfjs-dist'))),
);

/** The reader's command line: Node's flags, the reader, and its arguments. */
export function readerFlags(memoryMb: number): string[] {
  return [
    '--permission',
    `--allow-fs-read=${STORAGE_DIR}${sep}`,
    `--allow-fs-read=${PDFJS_DIR}${sep}`,
    // The memory cap is a thread of the reader's own (./memory-cap.ts); a thread keeps the reader's permissions.
    '--allow-worker',
    '--disallow-code-generation-from-strings',
    `--max-old-space-size=${String(MAX_HEAP_MB)}`,
    READER,
    String(MAX_PDF_PAGES),
    String(MAX_PDF_TEXT_CHARS),
    String(memoryMb),
  ];
}

// Control characters other than a line break or a tab: Postgres refuses NUL in text, and none of them is text to read.
const CONTROL = /(?![\n\t])\p{Cc}/gu;
// Text worth keeping has at least one letter or digit, in any script.
const READABLE = /[\p{L}\p{N}]/u;

type Answer = { pages: number; text: string } | { refused: 'locked' | 'too-many-pages' };

function parseAnswer(output: Buffer): Answer {
  const answer: unknown = JSON.parse(output.toString('utf8'));
  if (typeof answer === 'object' && answer !== null) {
    if (
      'refused' in answer &&
      (answer.refused === 'locked' || answer.refused === 'too-many-pages')
    ) {
      return { refused: answer.refused };
    }
    if (
      'pages' in answer &&
      'text' in answer &&
      typeof answer.pages === 'number' &&
      typeof answer.text === 'string'
    ) {
      return { pages: answer.pages, text: answer.text };
    }
  }
  throw new Error('the PDF reader gave no answer');
}

/** Runs the reader on `pdf`, killed after `seconds` or past `memoryMb`; its errors and its stderr are never read. */
function runReader(pdf: Uint8Array, seconds: number, memoryMb: number): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      readerFlags(memoryMb),
      {
        encoding: 'buffer',
        env: {},
        timeout: seconds * 1000,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_ANSWER_BYTES,
      },
      (error, output) => {
        if (error === null) {
          try {
            resolve(parseAnswer(output));
          } catch {
            reject(new PdfRefusedError('unreadable'));
          }
        } else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          reject(new PdfRefusedError('unreadable'));
        } else if (error.killed) {
          // Killed by us, and only the time limit kills it.
          reject(new PdfRefusedError('too-slow'));
        } else if (error.signal === 'SIGKILL') {
          // Killed, not by us: by its memory cap (or the system, out of memory).
          reject(new PdfRefusedError('too-much-memory'));
        } else {
          reject(new PdfRefusedError('unreadable'));
        }
      },
    );
    // A process that ends before it has read the whole PDF breaks the pipe (EPIPE) mid-write; how it ended is what
    // counts, and without this handler the broken pipe would end the worker (tested: "carries on when the reader ends…").
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(pdf);
  });
}

/**
 * The text of a PDF, its pages one after another with a blank line between them, or a `PdfRefusedError` with a message
 * safe to show. `bytes` is the whole upload, at most `MAX_PDF_BYTES`. `seconds` (a whole number from 1
 * to 60) bounds the whole read, and `memoryMb` (a whole number from 1 to 4096) the reader's resident memory.
 */
export async function readPdfText(
  bytes: Uint8Array,
  {
    seconds = PDF_TIME_LIMIT_SECONDS,
    memoryMb = MAX_READER_MEMORY_MB,
  }: { seconds?: number; memoryMb?: number } = {},
): Promise<{ text: string; pages: number }> {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) {
    throw new RangeError('seconds must be a whole number from 1 to 60');
  }
  if (!Number.isInteger(memoryMb) || memoryMb < 1 || memoryMb > 4096) {
    throw new RangeError('memoryMb must be a whole number from 1 to 4096');
  }
  if (!isPdf(bytes)) throw new PdfRefusedError('not-a-pdf');
  if (bytes.byteLength > MAX_PDF_BYTES) throw new PdfRefusedError('too-large');
  const answer = await runReader(bytes, seconds, memoryMb);
  if ('refused' in answer) throw new PdfRefusedError(answer.refused);
  const text = answer.text.replace(CONTROL, '').toWellFormed().trim();
  if (!READABLE.test(text)) throw new PdfRefusedError('no-text');
  return { text, pages: answer.pages };
}

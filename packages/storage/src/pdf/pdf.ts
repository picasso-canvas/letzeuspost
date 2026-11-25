// Reading an uploaded PDF (§06 Reading uploaded files: "PDFs are read as text"; #402). A PDF is untrusted, like any
// upload (§10, §13 Security summary), so it gets the walls an SVG gets (../images.ts):
// - its type comes from its first bytes (`%PDF-`), never its name or the type the browser sent;
// - it is read by pdf.js (pdfjs-dist, Apache-2.0, pinned) in a process of its own (./read-pdf-text.ts) that gets no
//   environment, may write at most what the text cap needs, and is killed at the time limit (15 s, Athena's reading of
//   §10's "5–15 s a photo"), so a crafted file can't hold the worker or reach its secrets;
// - only its text is read: no page is drawn, no font loaded, no script run, nothing fetched;
// - at most 100 pages (Athena, #402), counted from the file's page tree before any page is read, and at most a million
//   characters of text are kept (about 200 pages of dense text; a cap of this package's, so one file can't fill a row).
// A PDF that can't be read, is locked, is too long, too slow, or holds no text is refused with a `PdfRefusedError`,
// whose message is safe to show to the person who sent it and holds nothing of the file.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type PdfRefusalReason =
  'not-a-pdf' | 'unreadable' | 'locked' | 'too-many-pages' | 'no-text' | 'too-slow';

export class PdfRefusedError extends Error {
  override readonly name = 'PdfRefusedError';
  readonly reason: PdfRefusalReason;
  constructor(reason: PdfRefusalReason) {
    super(MESSAGES[reason]);
    this.reason = reason;
  }
}

/** The most pages a PDF may have (Athena, #402). */
export const MAX_PDF_PAGES = 100;
/** How long reading a PDF may take before it is refused (Athena, #402). */
export const PDF_TIME_LIMIT_SECONDS = 15;
/** The most characters of a PDF's text that are kept; the rest is left unread. */
export const MAX_PDF_TEXT_CHARS = 1_000_000;

const MESSAGES: Readonly<Record<PdfRefusalReason, string>> = {
  'not-a-pdf': "That file isn't a PDF.",
  unreadable: "This PDF couldn't be read. Please save it again as a PDF and upload it.",
  locked: 'This PDF is protected by a password. Please upload a copy without one.',
  'too-many-pages': `This PDF is too long: at most ${String(MAX_PDF_PAGES)} pages.`,
  'no-text':
    'This PDF has no text we can read. If it is scanned, please upload its pages as images.',
  'too-slow': 'This PDF took too long to read. Please save it again as a simpler PDF.',
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
// pdf.js's own objects stay well within this; past it the process ends, and the PDF is refused as unreadable.
const MAX_HEAP_MB = 512;

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

/** Runs the reader on `pdf`, killed after `seconds`; its errors and its stderr are never read. */
function runReader(pdf: Uint8Array, seconds: number): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [
        `--max-old-space-size=${String(MAX_HEAP_MB)}`,
        READER,
        String(MAX_PDF_PAGES),
        String(MAX_PDF_TEXT_CHARS),
      ],
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
        } else if (error.killed && error.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          // Killed by the time limit (a process that ran out of memory or crashed wasn't killed by us).
          reject(new PdfRefusedError('too-slow'));
        } else {
          reject(new PdfRefusedError('unreadable'));
        }
      },
    );
    // A process that fails before it has read the whole PDF closes its stdin; how it ended is what counts.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(pdf);
  });
}

/**
 * The text of a PDF, its pages one after another with a blank line between them, or a `PdfRefusedError` with a message
 * safe to show. `bytes` is the whole upload, already capped in size by `Storage.get`. `seconds` (a whole number from 1
 * to 60) bounds the whole read.
 */
export async function readPdfText(
  bytes: Uint8Array,
  { seconds = PDF_TIME_LIMIT_SECONDS }: { seconds?: number } = {},
): Promise<{ text: string; pages: number }> {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) {
    throw new RangeError('seconds must be a whole number from 1 to 60');
  }
  if (!isPdf(bytes)) throw new PdfRefusedError('not-a-pdf');
  const answer = await runReader(bytes, seconds);
  if ('refused' in answer) throw new PdfRefusedError(answer.refused);
  const text = answer.text.replace(CONTROL, '').toWellFormed().trim();
  if (!READABLE.test(text)) throw new PdfRefusedError('no-text');
  return { text, pages: answer.pages };
}

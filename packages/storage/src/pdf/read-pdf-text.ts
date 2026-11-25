// Reads one PDF's text in a process of its own (§06, §13). `pdf.ts` runs this file with the PDF on stdin and SIGKILLs it
// at the time limit: pdf.js parses on this process's one thread, and a crafted file (a content stream that inflates to
// gigabytes, a loop pdf.js doesn't see) could otherwise hold the worker. A killed process holds nothing, and this one
// gets no environment, so no secrets.
//
// Text only: no page is drawn, no font is loaded, no script is run (pdf.js runs none outside its viewer), and nothing
// is fetched. Arguments: the most pages to read, and the most characters to keep. Output: one line of JSON on stdout,
// `{ "pages", "text" }`, or `{ "refused" }` for a locked PDF or one with too many pages. Anything else exits with an
// error, and `pdf.ts` refuses the PDF without reading why.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

function limit(argument: string | undefined): number {
  const value = Number(argument);
  if (!Number.isInteger(value) || value < 1) throw new Error('usage: <max pages> <max characters>');
  return value;
}
const maxPages = limit(process.argv[2]);
const maxChars = limit(process.argv[3]);

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  if (!Buffer.isBuffer(chunk)) throw new Error('stdin sent something other than bytes');
  chunks.push(chunk);
}

type Answer = { pages: number; text: string } | { refused: 'locked' | 'too-many-pages' };

async function read(data: Uint8Array): Promise<Answer> {
  const loading = getDocument({
    data,
    // Nothing from outside the file: no fonts, character maps, wasm or system fonts are fetched or read.
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    useWasm: false,
    enableXfa: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    stopAtErrors: false,
    // Errors only, and only on this process's stderr, which pdf.ts never reads.
    verbosity: 0,
  });
  let pdf;
  try {
    pdf = await loading.promise;
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') return { refused: 'locked' };
    throw error;
  }
  // Before any page is read. pdf.js checks the count the page tree claims against the pages it holds, so a tree that
  // claims a million pages and holds one counts as one.
  if (pdf.numPages > maxPages) return { refused: 'too-many-pages' };

  const pages: string[] = [];
  let length = 0;
  for (let number = 1; number <= pdf.numPages && length < maxChars; number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ''}` : ''))
      .join('')
      .trim();
    if (text !== '') pages.push(text);
    length += text.length + 2;
    page.cleanup();
  }
  return { pages: pdf.numPages, text: pages.join('\n\n').slice(0, maxChars) };
}

const answer = await read(new Uint8Array(Buffer.concat(chunks)));
// Exits only once the answer has been handed to the pipe: an exit straight after `write` can cut it short.
process.stdout.write(JSON.stringify(answer), () => process.exit(0));

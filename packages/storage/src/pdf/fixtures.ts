// PDFs for the tests (§06 Reading uploaded files, §17 crafted uploads), built from bytes here so what each one carries is
// visible: plain text, a page count that lies, a page tree and a cross-reference that loop, a content stream that
// inflates to hundreds of megabytes, a password, a script and an attached file. Only tests import this file.
import { deflateSync } from 'node:zlib';

type Part = string | Uint8Array;

const bytes = (part: Part): Buffer =>
  typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part);

/** A stream object's body: its dictionary, its length and its data. */
export function stream(dictionary: string, data: Part): Buffer {
  const body = bytes(data);
  return Buffer.concat([
    bytes(`<< ${dictionary} /Length ${String(body.length)} >>\nstream\n`),
    body,
    bytes('\nendstream'),
  ]);
}

/**
 * A whole PDF: object `n` is `objects[n - 1]`, the catalog is object 1, and the cross-reference table gives each
 * object's real offset. `trailer` adds entries to the trailer (an `/Encrypt`, a `/Prev`).
 */
export function buildPdf(objects: readonly Part[], { trailer = '' } = {}): Uint8Array {
  const parts: Buffer[] = [bytes('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')];
  let offset = parts[0]?.length ?? 0;
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    const part = Buffer.concat([
      bytes(`${String(index + 1)} 0 obj\n`),
      bytes(object),
      bytes('\nendobj\n'),
    ]);
    offsets.push(offset);
    offset += part.length;
    parts.push(part);
  });
  const xref = [
    `xref\n0 ${String(objects.length + 1)}\n`,
    '0000000000 65535 f \n',
    ...offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`),
  ].join('');
  parts.push(
    bytes(
      `${xref}trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R ${trailer} >>\nstartxref\n${String(offset)}\n%%EOF\n`,
    ),
  );
  return new Uint8Array(Buffer.concat(parts));
}

/** Text as a PDF string literal: backslashes and brackets escaped. */
function literal(text: string): string {
  return `(${text.replace(/[\\()]/g, (character) => `\\${character}`)})`;
}

/**
 * A content stream that writes each line of `text` in Helvetica at `size` points, from the top left of the page down.
 * pdf.js leaves out text drawn off the page, so a long text needs a small size.
 */
function textContent(text: string, size: number): Buffer {
  const lines = text.split('\n').map((line) => `${literal(line)} Tj T*`);
  const leading = String(size * 1.2);
  return stream('', `BT /F1 ${String(size)} Tf ${leading} TL 36 780 Td\n${lines.join('\n')}\nET`);
}

/**
 * A PDF with one page per entry of `pages`, each page's text in Helvetica at `size` points (Latin-1 text only).
 * `catalog` adds entries to the catalog (an `/OpenAction`, `/Names`), `extra` adds objects after the pages, numbered
 * from there on, and `count` is the page count the page tree claims.
 */
export function textPdf(
  pages: readonly string[],
  {
    catalog = '',
    extra = [] as readonly Part[],
    trailer = '',
    count = pages.length,
    size = 12,
  } = {},
): Uint8Array {
  // 1 catalog, 2 page tree, 3 font, then a page and its content for each page.
  const firstPage = 4;
  const kids = pages.map((_, i) => `${String(firstPage + i * 2)} 0 R`).join(' ');
  const objects: Part[] = [
    `<< /Type /Catalog /Pages 2 0 R ${catalog} >>`,
    `<< /Type /Pages /Kids [${kids}] /Count ${String(count)} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  pages.forEach((text, i) => {
    const content = firstPage + i * 2 + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(content)} 0 R >>`,
      textContent(text, size),
    );
  });
  return buildPdf([...objects, ...extra], { trailer });
}

/** The number the next object of a `textPdf` of `pages` pages gets, for `extra` objects to refer to each other. */
export const nextObject = (pages: number): number => 4 + pages * 2;

/**
 * Bangla in a PDF: a composite font whose glyph codes 1 to 4 map, through its `/ToUnicode` table, to the characters of
 * "বাংলা". The font's own file isn't embedded: text extraction reads only the table.
 */
export function banglaPdf(): Uint8Array {
  const toUnicode = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def /CMapType 2 def',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    '5 beginbfchar <0001> <09AC> <0002> <09BE> <0003> <0982> <0004> <09B2> <0005> <09BE> endbfchar',
    'endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    stream('', 'BT /F1 24 Tf 72 720 Td <0001000200030004 0005> Tj ET'),
    '<< /Type /Font /Subtype /Type0 /BaseFont /NotoSansBengali /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NotoSansBengali /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /DW 600 >>',
    stream('', toUnicode),
    '<< /Type /FontDescriptor /FontName /NotoSansBengali /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 1000 /Descent 0 /CapHeight 700 /StemV 80 >>',
  ]);
}

/** A page that only draws: a line, no text at all. */
export function drawingOnlyPdf(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    stream('', '0 0 m 612 792 l S'),
  ]);
}

/** One real page whose page tree says it holds a million. */
export function pageCountLiePdf(): Uint8Array {
  return textPdf(['Only one page here.'], { count: 1_000_000 });
}

/** A page tree whose node lists itself as its own child, and a cross-reference section that names itself as previous. */
export function loopingPdf(): Uint8Array {
  const pdf = Buffer.from(
    buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 2 >>',
      '<< /Type /Pages /Parent 2 0 R /Kids [2 0 R 3 0 R] /Count 2 >>',
    ]),
  );
  // `/Prev` points at this same table, so following the chain of tables never ends.
  const startxref = /startxref\n(\d+)/.exec(pdf.toString('latin1'))?.[1] ?? '0';
  return new Uint8Array(
    Buffer.from(
      pdf.toString('latin1').replace('/Root 1 0 R', `/Root 1 0 R /Prev ${startxref}`),
      'latin1',
    ),
  );
}

/**
 * A decompression bomb: one page whose content stream is a few hundred kilobytes of Flate data that inflates to
 * `megabytes` of drawing commands, and no text.
 */
export function bombPdf(megabytes: number): Uint8Array {
  const line = Buffer.from('0 0 m 1 1 l S\n', 'latin1');
  const content = Buffer.alloc(megabytes * 1024 * 1024, line);
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    stream('/Filter /FlateDecode', deflateSync(content, { level: 9 })),
  ]);
}

/** Encrypted for a user password nobody gave us: the standard security handler, revision 2, with made-up keys. */
export function lockedPdf(): Uint8Array {
  const key = (byte: string) => `<${byte.repeat(32)}>`;
  const pages = 1;
  return textPdf(['A secret menu.'], {
    extra: [`<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O ${key('5a')} /U ${key('c3')} >>`],
    trailer: `/Encrypt ${String(nextObject(pages))} 0 R /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>]`,
  });
}

/** Text, plus a script that runs on opening and an attached file, neither of which is the page's text. */
export function scriptedPdf(text: string): Uint8Array {
  const js = nextObject(1);
  const file = js + 1;
  const spec = js + 2;
  return textPdf([text], {
    catalog: `/OpenAction ${String(js)} 0 R /Names << /EmbeddedFiles << /Names [(payload.txt) ${String(spec)} 0 R] >> >>`,
    extra: [
      "<< /Type /Action /S /JavaScript /JS (app.alert\\('script-ran'\\); this.exportDataObject\\({cName: 'payload.txt'}\\);) >>",
      stream('/Type /EmbeddedFile', 'attached-file-contents'),
      `<< /Type /Filespec /F (payload.txt) /EF << /F ${String(file)} 0 R >> >>`,
    ],
  });
}

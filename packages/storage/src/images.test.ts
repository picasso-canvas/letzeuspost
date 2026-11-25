// Processing an upload (§10 Processing every image, §13 Security summary, §17 crafted uploads): every fixture here is
// built from bytes in the test, so what each one smuggles is visible: a name that lies about its type, a polyglot,
// location and camera data in EXIF, a pixel bomb, an SVG with a script. Each must be refused or come out clean.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import sharp, { type Metadata } from 'sharp';
import { describe, expect, it } from 'vitest';
import { assetKey } from './keys.ts';
import {
  ImageRefusedError,
  MAX_INPUT_PIXELS,
  processImage,
  saveImageSet,
  type ImageSet,
} from './images.ts';
import type { Storage } from './storage.ts';

const WORKSPACE = '019a5c3e-7b1a-7c2d-8e3f-4a5b6c7d8e9f';
const BRAND = '019a5c3e-7b1b-7000-8000-000000000001';
const ASSET = '019a5c3e-7b1b-7000-8000-000000000002';
const ctx = { workspaceId: WORKSPACE };

const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };

/** A plain picture: solid colour, any size, in the format asked for. */
async function solid(
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp',
  colour = RED,
): Promise<Uint8Array> {
  const image = sharp({ create: { width, height, channels: 3, background: colour } });
  return new Uint8Array(await image.toFormat(format).toBuffer());
}

/** A horizontal grey ramp, dark on the left: a picture with something for a perceptual hash to see. */
async function ramp(width: number, height: number, format: 'jpeg' | 'png'): Promise<Uint8Array> {
  const pixels = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) pixels[y * width + x] = Math.round((x / width) * 255);
  }
  const image = sharp(pixels, { raw: { width, height, channels: 1 } });
  return new Uint8Array(await image.toFormat(format).toBuffer());
}

/** Vertical stripes, one per colour, each `widths[i]` pixels wide; PNG, so the colours stay exact. */
async function stripes(
  colours: readonly { r: number; g: number; b: number }[],
  widths: readonly number[],
  height = 20,
): Promise<Uint8Array> {
  const width = widths.reduce((sum, w) => sum + w, 0);
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    let x = 0;
    colours.forEach((colour, i) => {
      for (let end = x + (widths[i] ?? 0); x < end; x += 1) {
        pixels.set([colour.r, colour.g, colour.b], (y * width + x) * 3);
      }
    });
  }
  const image = sharp(pixels, { raw: { width, height, channels: 3 } });
  return new Uint8Array(await image.png().toBuffer());
}

/** One PNG chunk: length, type, data, CRC. */
function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A pixel bomb: a few hundred bytes whose header claims `width` × `height` RGB pixels. */
function pngClaiming(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB, deflate, no filter, no interlace
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', deflateSync(Buffer.alloc(1024))),
      pngChunk('IEND', new Uint8Array()),
    ]),
  );
}

const CAMERA = 'LZP-SECRET-CAMERA';

/**
 * An EXIF block (big-endian TIFF) with the camera's make in IFD0 and a GPS IFD holding latitude 23° 48′ N, Dhaka.
 * Offsets: IFD0 at 8 (2 entries, 30 bytes), the make at 38 (18 bytes), the GPS IFD at 56 (30 bytes), the latitude's
 * three rationals at 86 (24 bytes).
 */
function exifWithGps(): Buffer {
  const tiff = Buffer.alloc(110);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  const entry = (at: number, tag: number, type: number, count: number, value: number): void => {
    tiff.writeUInt16BE(tag, at);
    tiff.writeUInt16BE(type, at + 2);
    tiff.writeUInt32BE(count, at + 4);
    tiff.writeUInt32BE(value, at + 8);
  };
  tiff.writeUInt16BE(2, 8);
  entry(10, 0x010f, 2, CAMERA.length + 1, 38); // Make, ASCII
  entry(22, 0x8825, 4, 1, 56); // GPSInfo, LONG: the GPS IFD's offset
  tiff.writeUInt32BE(0, 34);
  tiff.write(`${CAMERA}\0`, 38, 'latin1');
  tiff.writeUInt16BE(2, 56);
  entry(58, 0x0001, 2, 2, 0); // GPSLatitudeRef, ASCII "N", inline
  tiff.write('N\0', 66, 'latin1');
  entry(70, 0x0002, 5, 3, 86); // GPSLatitude, three RATIONALs
  tiff.writeUInt32BE(0, 82);
  [23, 1, 48, 1, 0, 1].forEach((n, i) => tiff.writeUInt32BE(n, 86 + i * 4));
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
}

/** A JPEG segment: marker, big-endian length (which counts itself), data. */
function jpegSegment(marker: number, data: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
}

/** `jpeg` with `segments` put right after its start-of-image marker, and `trailer` after its end. */
function spliceJpeg(jpeg: Uint8Array, segments: Buffer[], trailer = Buffer.alloc(0)): Uint8Array {
  const bytes = Buffer.from(jpeg);
  return new Uint8Array(
    Buffer.concat([bytes.subarray(0, 2), ...segments, bytes.subarray(2), trailer]),
  );
}

const SCRIPT = '<script>alert(document.cookie)</script>';
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Whether `needle` appears anywhere in `bytes`. */
function contains(bytes: Uint8Array, needle: string | Buffer): boolean {
  return Buffer.from(bytes).includes(needle);
}

function outputs(set: ImageSet): [string, Uint8Array][] {
  return Object.entries(set.files).map(([variant, file]) => [variant, file.data]);
}

async function refusal(bytes: Uint8Array): Promise<ImageRefusedError> {
  const error: unknown = await processImage(bytes).then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof ImageRefusedError)) {
    throw new Error(`expected an ImageRefusedError, got ${String(error)}`);
  }
  return error;
}

/** An ICC profile's readable text (its description is UTF-16 in an `mluc` tag), or '' with no profile. */
function profileName(icc: Buffer | undefined): string {
  return Buffer.from(icc ?? [])
    .toString('latin1')
    .replace(/[^ -~]/g, '');
}

async function meta(bytes: Uint8Array): Promise<Metadata> {
  return sharp(bytes).metadata();
}

describe('crafted uploads', () => {
  it('are judged by their bytes, never their name: an HTML page called holiday.jpg is refused', async () => {
    const upload = { name: 'holiday.jpg', bytes: Buffer.from(`<!doctype html><html>${SCRIPT}`) };
    expect((await refusal(new Uint8Array(upload.bytes))).reason).toBe('not-an-image');
  });

  it('are judged by their bytes: a PNG called logo.jpg comes out as the PNG it is', async () => {
    const upload = { name: 'logo.jpg', bytes: await solid(40, 30, 'png') };
    const set = await processImage(upload.bytes);
    expect(set.type).toBe('png');
    expect(set.files.original.contentType).toBe('image/png');
    expect((await meta(set.files.original.data)).format).toBe('png');
  });

  it('refuse a file that starts like a JPEG and is something else after its first bytes', async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(SCRIPT)]);
    expect((await refusal(new Uint8Array(fake))).reason).toBe('unreadable');
  });

  it('refuse what is not a JPG, PNG, WebP or SVG: GIF, HEIC, PDF, ZIP, an empty file', async () => {
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: RED } })
      .gif()
      .toBuffer();
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypheic\0\0\0\0mif1heic'),
    ]);
    const others = [gif, heic, Buffer.from('%PDF-1.7\n'), ZIP_HEADER, Buffer.alloc(0)];
    for (const bytes of others) {
      expect(
        (await refusal(new Uint8Array(bytes))).reason,
        bytes.subarray(0, 8).toString('hex'),
      ).toBe('not-an-image');
    }
  });

  it('a polyglot JPEG (a script in a comment, a zip and a page after its end) comes out as pixels only', async () => {
    const polyglot = spliceJpeg(
      await solid(64, 48, 'jpeg'),
      [jpegSegment(0xfe, Buffer.from(SCRIPT))],
      Buffer.concat([ZIP_HEADER, Buffer.from(`hidden.html<html>${SCRIPT}</html>`)]),
    );
    expect(contains(polyglot, SCRIPT)).toBe(true);
    const set = await processImage(polyglot);
    for (const [variant, data] of outputs(set)) {
      expect(contains(data, 'script'), variant).toBe(false);
      expect(contains(data, ZIP_HEADER), variant).toBe(false);
    }
  });

  it('a polyglot PNG (a script in a text chunk and after its end) comes out as pixels only', async () => {
    const png = Buffer.from(await solid(64, 48, 'png'));
    const afterHeader = 8 + 25; // the signature, then the IHDR chunk
    const polyglot = Buffer.concat([
      png.subarray(0, afterHeader),
      pngChunk('tEXt', Buffer.from(`Comment\0${SCRIPT}`, 'latin1')),
      png.subarray(afterHeader),
      Buffer.from(SCRIPT),
    ]);
    expect((await meta(polyglot)).comments).toBeDefined();
    const set = await processImage(new Uint8Array(polyglot));
    for (const [variant, data] of outputs(set)) {
      expect(contains(data, 'script'), variant).toBe(false);
      expect((await meta(data)).comments, variant).toBeUndefined();
    }
  });

  it('location and camera data in EXIF are removed from every output, re-read to check', async () => {
    const photo = spliceJpeg(await solid(64, 48, 'jpeg'), [jpegSegment(0xe1, exifWithGps())]);
    const before = await meta(photo);
    expect(before.exif).toBeDefined();
    expect(contains(photo, CAMERA)).toBe(true);
    const set = await processImage(photo);
    for (const [variant, data] of outputs(set)) {
      const after = await meta(data);
      expect(after.exif, variant).toBeUndefined();
      expect(after.xmp, variant).toBeUndefined();
      expect(after.iptc, variant).toBeUndefined();
      expect(contains(data, CAMERA), variant).toBe(false);
      expect(contains(data, 'Exif'), variant).toBe(false);
    }
  });

  it('a pixel bomb is refused from its header, before its pixels are decoded', async () => {
    const bomb = pngClaiming(40_000, 40_000);
    expect(bomb.length).toBeLessThan(1000);
    const error = await refusal(bomb);
    expect(error.reason).toBe('too-many-pixels');
  });

  it('the pixel limit is exact: one pixel over is refused as a bomb, the limit itself is not', async () => {
    const side = Math.sqrt(MAX_INPUT_PIXELS);
    expect(Number.isInteger(side)).toBe(true);
    expect((await refusal(pngClaiming(side, side + 1))).reason).toBe('too-many-pixels');
    // At the limit the size is allowed; this file's pixels are missing, so it fails later, as unreadable.
    expect((await refusal(pngClaiming(side, side))).reason).toBe('unreadable');
  });

  it('an SVG that claims 50000 px is drawn at 4096 px at most, never at the size it claims', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="50000" height="25000"><rect width="10" height="10"/></svg>';
    const set = await processImage(new Uint8Array(Buffer.from(svg)));
    expect(set.files.original).toMatchObject({ width: 4096, height: 2048 });
  });

  it('an SVG with a script is rasterised: no output is SVG, and the script is gone', async () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- a logo -->
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" onload="alert(1)">
  ${SCRIPT}
  <rect width="120" height="60" fill="#ff0000"/>
  <a><text x="10" y="30" onclick="alert(2)">hi</text></a>
</svg>`;
    const set = await processImage(new Uint8Array(Buffer.from(svg)));
    expect(set.type).toBe('svg');
    for (const [variant, file] of Object.entries(set.files)) {
      expect(file.contentType, variant).not.toContain('svg');
      expect(['png', 'webp'], variant).toContain((await meta(file.data)).format);
      expect(contains(file.data, 'script'), variant).toBe(false);
      expect(contains(file.data, 'alert'), variant).toBe(false);
    }
    expect(set.files.original.contentType).toBe('image/png');
    // Drawn so its longest side is 4096 px: a vector logo is never stored too small to use (§10 resolution check).
    expect(set.files.original).toMatchObject({ width: 4096, height: 2048 });
  });

  it('an SVG saved with a byte-order mark is still read as an SVG', async () => {
    const svg = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>'),
    ]);
    expect((await processImage(new Uint8Array(svg))).type).toBe('svg');
  });

  it('a file of many XML comments and no SVG is refused at once, without the sniffer backtracking', async () => {
    const comments = Buffer.from(`<?xml version="1.0"?>${'<!-- a -->'.repeat(40)}<html>`);
    expect((await refusal(new Uint8Array(comments))).reason).toBe('not-an-image');
    const doctypes = Buffer.from(`${'<!DOCTYPE a    >'.repeat(40)}<html>`);
    expect((await refusal(new Uint8Array(doctypes))).reason).toBe('not-an-image');
  });

  it('an SVG that declares a DOCTYPE (entity expansion, outside files) is refused', async () => {
    const svg = `<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>&b;</text></svg>`;
    expect((await refusal(new Uint8Array(Buffer.from(svg)))).reason).toBe('unsafe-svg');
  });
});

/** An SVG document around `body`, 100 px square, with the xlink namespace declared. */
function svgWith(body: string, prolog = ''): Uint8Array {
  return new Uint8Array(
    Buffer.from(
      `${prolog}<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100">${body}</svg>`,
    ),
  );
}

const METADATA = 'http://169.254.169.254/latest/meta-data/';

describe('an SVG that reaches outside itself', () => {
  it('is refused when it embeds a data: PNG bomb, which librsvg would decode at its full size', async () => {
    const bomb = Buffer.from(pngClaiming(40_000, 40_000)).toString('base64');
    const svg = svgWith(`<image width="100" height="100" href="data:image/png;base64,${bomb}"/>`);
    expect(svg.length).toBeLessThan(2000);
    expect((await refusal(svg)).reason).toBe('unsafe-svg');
  });

  it('is refused when it embeds a data: SVG that declares entities, out of sight of the DOCTYPE check', async () => {
    const inner = Buffer.from(
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>&a;</text></svg>',
    ).toString('base64');
    const svg = svgWith(
      `<image width="100" height="100" href="data:image/svg+xml;base64,${inner}"/>`,
    );
    expect(Buffer.from(svg).includes('DOCTYPE')).toBe(false);
    expect((await refusal(svg)).reason).toBe('unsafe-svg');
  });

  it('is refused for a file: or cloud-metadata link, in any element, attribute or stylesheet', async () => {
    const bodies = [
      '<image width="10" height="10" href="file:///etc/passwd"/>',
      `<image width="10" height="10" xlink:href="${METADATA}"/>`,
      '<use xlink:href="file:///etc/hosts#a"/>',
      `<use href="${METADATA}#a"/>`,
      `<filter id="f"><feImage href="${METADATA}"/></filter>`,
      `<rect width="10" height="10" fill="url(${METADATA}#a)"/>`,
      `<rect width="10" height="10" style="fill: url('file:///etc/passwd#a')"/>`,
      `<style>@import url(${METADATA});</style>`,
      `<style>@import "file:///etc/passwd";</style>`,
      `<foreignObject width="10" height="10"><p xmlns="http://www.w3.org/1999/xhtml">hi</p></foreignObject>`,
      `<svg:image xmlns:svg="http://www.w3.org/2000/svg" width="10" height="10"/>`,
      `<a href="javascript:alert(1)"><text>hi</text></a>`,
    ];
    for (const body of bodies) {
      expect((await refusal(svgWith(body))).reason, body).toBe('unsafe-svg');
    }
  });

  it('is refused when the link is hidden behind a character reference, a CSS escape or another encoding', async () => {
    const svgs = [
      svgWith('<use href="&#x66;ile:///etc/hosts#a"/>'),
      svgWith(`<rect width="10" height="10" fill="&#117;rl(${METADATA}#a)"/>`),
      svgWith(`<style>rect { fill: u\\72 l(${METADATA}#a) }</style><rect width="10" height="10"/>`),
      svgWith(`<style>@\\69mport "file:///etc/passwd";</style>`),
      svgWith(
        '+ADw-image href+AD0AIg-file:///etc/passwd+ACI-/+AD4-',
        '<?xml version="1.0" encoding="UTF-7"?>',
      ),
      new Uint8Array(
        Buffer.concat([
          Buffer.from(svgWith('<text>')),
          Buffer.from([0xc0, 0xaf]),
          Buffer.from('</text>'),
        ]),
      ),
    ];
    for (const svg of svgs) {
      expect((await refusal(svg)).reason, Buffer.from(svg).toString('latin1')).toBe('unsafe-svg');
    }
  });

  it('keeps a logo that only points inside itself: gradients, clips and reused shapes by #id', async () => {
    const svg = svgWith(
      `<defs>
        <linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient>
        <clipPath id="c"><circle cx="50" cy="50" r="40"/></clipPath>
        <rect id="r" width="20" height="20"/>
      </defs>
      <rect width="100" height="100" fill="url(#g)" clip-path="url( '#c' )"/>
      <use href="#r" x="10"/><use xlink:href="#r" y="60" style="fill: url(#g)"/>
      <text x="5" y="95">R&amp;D &#169; 2026</text>`,
      '<?xml version="1.0" encoding="utf-8"?>',
    );
    const set = await processImage(svg);
    expect(set.type).toBe('svg');
    expect(set.files.original).toMatchObject({ width: 4096, height: 4096 });
  });
});

// Checking an SVG runs on the worker's own thread, so a rule that backtracks would freeze it with no time limit. Each
// check here runs in a process of its own, timed there, and killed at `CHECK_DEADLINE_MS` (a thread can't be stopped
// in the middle of a regex): a rule that backtracks fails the test instead of hanging it.
const IMAGES_MODULE = fileURLToPath(new URL('./images.ts', import.meta.url));
const CHECK_DEADLINE_MS = 4000;
const TIMED_CHECK = `
const { processImage } = await import(process.argv.at(-1));
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const svg = new Uint8Array(Buffer.concat(chunks));
const start = performance.now();
const reason = await processImage(svg).then(
  () => 'kept',
  (error) => error.reason ?? String(error),
);
process.stdout.write(JSON.stringify({ reason, ms: performance.now() - start }));
`;

/** What `processImage` says about `svg` (a refusal reason, or `kept`), and how long it took, in a process of its own. */
function timedCheck(svg: Uint8Array): Promise<{ reason: string; ms: number }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ['--input-type=module', '--eval', TIMED_CHECK, IMAGES_MODULE],
      { timeout: CHECK_DEADLINE_MS, killSignal: 'SIGKILL' },
      (error, stdout) => {
        if (error === null) resolve(JSON.parse(stdout) as { reason: string; ms: number });
        else reject(new Error(`the SVG check did not finish in ${String(CHECK_DEADLINE_MS)} ms`));
      },
    );
    // A process killed before it has read the whole SVG closes its stdin; how it ended is what counts.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(svg);
  });
}

describe('an SVG that is slow to check', () => {
  it('is refused in well under a second: url( and 1 MB of whitespace, with no #', async () => {
    const svg = svgWith(
      `<rect width="10" height="10" style="fill: url(${' '.repeat(1_000_000)})"/>`,
    );
    const { reason, ms } = await timedCheck(svg);
    expect(reason).toBe('unsafe-svg');
    expect(ms).toBeLessThan(500);
  }, 10_000);

  it('is refused in well under a second: thousands of url( each with 1000 spaces and no #', async () => {
    const block = `<rect width="10" height="10" style="fill: url(${' '.repeat(1000)})"/>`;
    const svg = svgWith(block.repeat(5000));
    const { reason, ms } = await timedCheck(svg);
    expect(reason).toBe('unsafe-svg');
    expect(ms).toBeLessThan(500);
  }, 10_000);

  it('is refused in well under a second for long whitespace in every other rule: encoding, href', async () => {
    const spaces = ' '.repeat(1_000_000);
    const svgs = [
      // The rules look everywhere, not only in the prolog, which the sniffer reads 4 KB of.
      svgWith(`<text>encoding${spaces}=${spaces}"UTF-7"</text>`),
      svgWith(`<use href${spaces}=${spaces}"other.svg"/>`),
      svgWith(`<rect width="10" height="10" style="fill: url(${spaces}'${spaces}x)"/>`),
    ];
    for (const svg of svgs) {
      const { reason, ms } = await timedCheck(svg);
      expect(reason).toBe('unsafe-svg');
      expect(ms).toBeLessThan(500);
    }
  }, 20_000);
});

describe('an SVG that is slow to draw', () => {
  it('is stopped at the time limit and refused, even when one piece of it is slow: heavy filters', async () => {
    const blurs = [200, 201, 202, 203]
      .map((radius) => `<feGaussianBlur stdDeviation="${String(radius)}"/>`)
      .join('');
    const svg = svgWith(
      `<filter id="f" x="0" y="0" width="1" height="1"><feTurbulence baseFrequency="0.9" numOctaves="10"/>${blurs}</filter><rect width="100" height="100" filter="url(#f)"/>`,
    );
    expect(svg.length).toBeLessThan(1000);
    const error = await processImage(svg, { seconds: 1 }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ImageRefusedError);
    expect((error as ImageRefusedError).reason).toBe('unreadable');
  });

  it('is stopped at the time limit and refused: a fan-out of <use>, with no DOCTYPE', async () => {
    let defs = '<g id="g0"><rect width="1" height="1" opacity="0.5"/></g>';
    for (let level = 1; level <= 4; level += 1) {
      const uses = Array.from(
        { length: 10 },
        (_, i) => `<use href="#g${String(level - 1)}" x="${String(i % 3)}" y="${String(i % 5)}"/>`,
      ).join('');
      defs += `<g id="g${String(level)}">${uses}</g>`;
    }
    const svg = svgWith(`<defs>${defs}</defs><use href="#g4"/>`);
    const error = await processImage(svg, { seconds: 1 }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ImageRefusedError);
    expect((error as ImageRefusedError).reason).toBe('unreadable');
  });
});

describe('every processed image', () => {
  it('is converted to sRGB and tagged with it, from a CMYK JPEG and from a Display P3 PNG', async () => {
    const cmyk = await sharp({ create: { width: 32, height: 32, channels: 3, background: RED } })
      .toColourspace('cmyk')
      .jpeg()
      .toBuffer();
    const p3 = await sharp({ create: { width: 32, height: 32, channels: 3, background: RED } })
      .withIccProfile('p3')
      .png()
      .toBuffer();
    expect((await meta(cmyk)).space).toBe('cmyk');
    expect(profileName((await meta(p3)).icc)).toContain('P3');
    for (const input of [cmyk, p3]) {
      const set = await processImage(new Uint8Array(input));
      for (const [variant, data] of outputs(set)) {
        const after = await meta(data);
        expect(after.space, variant).toBe('srgb');
        expect(after.channels, variant).toBe(3);
        expect(profileName(after.icc), variant).toContain('sRGB');
        expect(profileName(after.icc), variant).not.toContain('P3');
      }
    }
  });

  it('is at most 4096 px on its longest side, and makes the 1600 and 360 copies from it', async () => {
    const set = await processImage(await solid(5000, 3000, 'jpeg'));
    expect(set.files.original).toMatchObject({ width: 4096, height: 2458 });
    expect(set.files['1600']).toMatchObject({ width: 1600, height: 960 });
    expect(set.files['360']).toMatchObject({ width: 360, height: 216 });
    const tall = await processImage(await solid(1000, 5000, 'png'));
    expect(tall.files.original).toMatchObject({ width: 819, height: 4096 });
    for (const [variant, file] of Object.entries(set.files)) {
      const after = await meta(file.data);
      expect([after.width, after.height], variant).toEqual([file.width, file.height]);
    }
  });

  it('is never enlarged: a small picture keeps its size in every copy', async () => {
    const set = await processImage(await solid(300, 200, 'webp'));
    for (const file of Object.values(set.files)) {
      expect(file).toMatchObject({ width: 300, height: 200 });
    }
  });

  it('is turned upright from its EXIF orientation, which is removed with the rest', async () => {
    const sideways = await sharp({
      create: { width: 40, height: 20, channels: 3, background: RED },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await meta(sideways)).orientation).toBe(6);
    const set = await processImage(new Uint8Array(sideways));
    expect(set.files.original).toMatchObject({ width: 20, height: 40 });
    expect((await meta(set.files.original.data)).orientation).toBeUndefined();
  });

  it('is re-encoded: a JPEG, PNG or WebP keeps its format at full size, and is never the uploaded file', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const input = await solid(50, 40, format);
      const set = await processImage(input);
      expect(set.type).toBe(format);
      expect(set.files.original.contentType).toBe(`image/${format}`);
      expect((await meta(set.files.original.data)).format).toBe(format);
      expect(Buffer.from(set.files.original.data).equals(Buffer.from(input))).toBe(false);
    }
  });
});

describe('the copies and the fingerprints', () => {
  it('the 1600 and 360 copies are WebP', async () => {
    const set = await processImage(await solid(2000, 1000, 'jpeg'));
    for (const variant of ['1600', '360'] as const) {
      expect(set.files[variant].contentType).toBe('image/webp');
      expect((await meta(set.files[variant].data)).format).toBe('webp');
    }
  });

  it('sha256 is the hash of the clean full-size file that is stored', async () => {
    const set = await processImage(await solid(50, 40, 'png'));
    expect(set.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(set.sha256).toBe(createHash('sha256').update(set.files.original.data).digest('hex'));
  });

  it('the perceptual hash is the same for one picture in another size and format, and far from another picture', async () => {
    const big = await processImage(await ramp(800, 600, 'jpeg'));
    const small = await processImage(await ramp(400, 300, 'png'));
    const flipped = await processImage(
      new Uint8Array(
        await sharp(await ramp(800, 600, 'png'))
          .flop()
          .png()
          .toBuffer(),
      ),
    );
    expect(big.perceptualHash).toMatch(/^[0-9a-f]{16}$/);
    expect(big.perceptualHash).toBe(small.perceptualHash);
    expect(distance(big.perceptualHash, flipped.perceptualHash)).toBeGreaterThan(32);
  });

  it('dominant colours come most common first, as #rrggbb', async () => {
    const set = await processImage(await stripes([BLUE, RED], [10, 30]));
    expect(set.dominantColors).toEqual(['#ff0000', '#0000ff']);
  });

  it('dominant colours are at most 5', async () => {
    const colours = [0, 40, 80, 120, 160, 200, 240].map((g) => ({ r: 255 - g, g, b: 0 }));
    const set = await processImage(await stripes(colours, [16, 14, 12, 10, 8, 6, 4]));
    expect(set.dominantColors).toEqual(['#ff0000', '#d72800', '#af5000', '#877800', '#5fa000']);
  });

  it('dominant colours leave out transparent pixels, so a logo on nothing is its own colour', async () => {
    const logo = await sharp({
      create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: {
            create: {
              width: 10,
              height: 10,
              channels: 4,
              background: { r: 0, g: 255, b: 0, alpha: 1 },
            },
          },
          left: 15,
          top: 15,
        },
      ])
      .png()
      .toBuffer();
    const set = await processImage(new Uint8Array(logo));
    expect(set.dominantColors).toEqual(['#00ff00']);
    expect((await meta(set.files.original.data)).hasAlpha).toBe(true);
  });
});

describe('saving a processed set', () => {
  it('writes each size under the key assetKey gives it, with its own type, and nowhere else; the original last', async () => {
    const writes: { key: string; contentType: string; size: number }[] = [];
    const recorder: Pick<Storage, 'put'> = {
      put: (_ctx, key, body, contentType) => {
        writes.push({ key, contentType, size: body.byteLength });
        return Promise.resolve();
      },
    };
    const set = await processImage(await solid(2000, 1000, 'jpeg'));
    await saveImageSet(recorder, ctx, { brandId: BRAND, assetId: ASSET }, set);
    expect(writes).toEqual(
      (['1600', '360', 'original'] as const).map((variant) => ({
        key: assetKey(ctx, { brandId: BRAND, assetId: ASSET, variant }),
        contentType: set.files[variant].contentType,
        size: set.files[variant].data.byteLength,
      })),
    );
  });
});

/** How many of two 64-bit hex hashes' bits differ. */
function distance(a: string, b: string): number {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let bits = 0;
  while (diff > 0n) {
    bits += Number(diff & 1n);
    diff >>= 1n;
  }
  return bits;
}

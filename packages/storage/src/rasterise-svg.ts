// Draws one SVG in a process of its own (§10, §13). `images.ts` runs this file with the SVG on stdin, and SIGKILLs it at
// the time limit. sharp's own `timeout` is checked only between tiles, and one tile of a crafted SVG (heavy filters, a
// fan-out of `<use>`) can take minutes. That would hold one of the worker's 2 image slots while every other workspace's
// uploads wait. A killed process holds nothing. Reading the SVG's size happens here too, because measuring an SVG that
// states no size walks the whole drawing.
//
// Arguments: the longest side to draw it at, and the most pixels it may decode. Output: a PNG on stdout. Anything
// else exits with an error, and `images.ts` refuses the upload without reading why.
import sharp from 'sharp';

const [maxSide, maxPixels] = process.argv.slice(2).map(Number);
if (maxSide === undefined || maxPixels === undefined)
  throw new Error('usage: <max side> <max pixels>');

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  if (!Buffer.isBuffer(chunk)) throw new Error('stdin sent something other than bytes');
  chunks.push(chunk);
}
const svg = Buffer.concat(chunks);

const header = await sharp(svg, { limitInputPixels: false }).metadata();
const longest = Math.max(header.width, header.height);
if (header.format !== 'svg' || !(longest > 0)) throw new Error('not an SVG with a size');
// sharp reads an SVG at 72 dpi by default, and takes 1 to 100000. This density makes its longest side `maxSide`.
const density = Math.min(100_000, Math.max(1, (72 * maxSide) / longest));
const png = await sharp(svg, { density, limitInputPixels: maxPixels, failOn: 'warning' })
  .png()
  .toBuffer();
process.stdout.write(png);

// The render outputs (§08 Outputs, When renders happen, and caching), their own entry `@lzp/render/output`: the JPEG,
// the PNG, the thumbnail and the LinkedIn PDF, every one made from what the image render drew, and the cache key of
// each. It needs sharp, node:crypto and Playwright, so it stays out of `@lzp/render`, which the editor loads too.
export {
  JPEG_QUALITIES,
  MAX_JPEG_BYTES,
  THUMBNAIL_WIDTH,
  toJpeg,
  toPng,
  toThumbnail,
  type JpegQuality,
} from './images.ts';
export {
  OUTPUT_FORMATS,
  RENDERER_VERSION,
  renderKey,
  type DocumentKeyInput,
  type ImageKeyInput,
  type KeyAsset,
  type OutputFormat,
  type RenderKeyInput,
} from './key.ts';
export { buildDocument, type DocumentInput } from './document.ts';
export {
  createDocumentPrinter,
  renderDocument,
  type DocumentPrinter,
  type DocumentPrinterOptions,
  type PrintInput,
} from './pdf.ts';

// @lzp/storage: the file store client, its keys, its signed links, the worker's reads and writes (§13 File storage),
// the processing that turns an upload into a clean image set (§10), and reading an uploaded PDF's text (§06).
export {
  isPdf,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_CHARS,
  PDF_TIME_LIMIT_SECONDS,
  PdfRefusedError,
  readPdfText,
  type PdfRefusalReason,
} from './pdf/pdf.ts';
export {
  ImageRefusedError,
  MAX_INPUT_PIXELS,
  MAX_SIDE,
  processImage,
  saveImageSet,
  type ImageFile,
  type ImageSet,
  type ImageType,
  type RefusalReason,
} from './images.ts';
export {
  assetKey,
  checkKey,
  exportKey,
  renderKey,
  StorageKeyError,
  type AssetVariant,
  type RenderFormat,
} from './keys.ts';
export {
  createStorage,
  EXPORT_LINK_SECONDS,
  LINK_SECONDS,
  UploadLimitError,
  type ObjectInfo,
  type SignedDownload,
  type SignedUpload,
  type Storage,
  type StorageSettings,
  type UploadLimits,
  type UploadRequest,
} from './storage.ts';

// @lzp/storage/signer: the file store client and its keys alone (§13 File storage), for the web app, which signs
// upload links (#403, Zeus's decision 1a on #403, 2026-11-27). It imports neither sharp nor pdfjs: the image
// processing and PDF reading are the worker's, from the package root.
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
  UPLOAD_LINK_SECONDS,
  UploadLimitError,
  type ObjectInfo,
  type SignedDownload,
  type SignedUpload,
  type Storage,
  type StorageSettings,
  type UploadLimits,
  type UploadRequest,
} from './storage.ts';

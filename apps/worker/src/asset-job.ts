// The `asset` job (#402, §06 Reading uploaded files and Asset library, §10 Processing every image, §13 Jobs and File
// storage): an uploaded original becomes a ready asset, or is rejected with a plain reason. Its payload is ids only;
// the asset is found by its id and its brand's together, in the job's workspace (`db` is that workspace's). Steps:
//   1. load the asset: only one still waiting to be processed goes on (gone, of another brand, or processed already:
//      left alone, so a rerun changes nothing);
//   2. read its original from the bucket, at most 20 MB (§06), never past that;
//   3. a PDF, given as a document, is read as text only, never drawn (@lzp/storage's PDF reader, in a process of its
//      own); any other file is checked and re-encoded as a picture with its two copies (#4, `processImage`), and the
//      three are written under the asset's keys, the original last;
//   4. mark it processed (packages/db's `finish`, one conditional update, which also marks a possible duplicate), or
//      rejected with the refusal's plain message.
// A file that isn't there yet, or a store or database that fails, fails the run and pg-boss retries it; on the last
// try the asset is rejected with a plain reason, so it never waits for ever.
//
// The log, and every error this job throws, name the asset by id and the outcome by code: never the file's content,
// text, name or key, nor the reason shown to its sender (§13 Security summary).
import { createHash } from 'node:crypto';
import {
  assetProcessing,
  type AssetProcessing,
  type AssetToProcess,
  type JobHandler,
  type ProcessedFile,
  type Scoped,
  type WorkspaceCtx,
} from '@lzp/db';
import {
  assetKey,
  ImageRefusedError,
  isPdf,
  MAX_PDF_BYTES,
  PdfRefusedError,
  processImage,
  readPdfText,
  saveImageSet,
  UploadLimitError,
  type Storage,
} from '@lzp/storage';
import type { Log } from './log.ts';

/** The largest file read: §06's "up to 20 MB each". */
export const MAX_FILE_BYTES = MAX_PDF_BYTES;

/** The reason on the last try when the store or the database kept failing. */
export const FAILED = "This file couldn't be processed. Please upload it again.";
const NEVER_ARRIVED = 'The file never arrived. Please upload it again.';
const TOO_LARGE = 'This file is too large: at most 20 MB.';
const PDF_NOT_DOCUMENT =
  'A PDF can be added only as a document. Please upload pictures as JPG, PNG, WebP or SVG.';
const NOT_A_DOCUMENT = "That file isn't a PDF or a JPG, PNG, WebP or SVG image.";

export interface AssetJobDeps {
  /** The bucket: the original is read from it and the picture's files written to it. */
  readonly storage: Pick<Storage, 'get' | 'put'>;
  readonly log: Log;
  /** The asset rows of the job's workspace; packages/db's by default. */
  readonly processing?: (db: Scoped) => AssetProcessing;
}

/** A file refused for good: `code` goes to the log, `reason` (plain, safe to show) to the row. */
interface Refusal {
  readonly refused: string;
  readonly reason: string;
}

/** The original isn't in the bucket (yet): the upload may still be on its way, so the run is retried. */
class NotArrivedError extends Error {
  override readonly name = 'NotArrivedError';
}

/** An error's name when it is a plain word, which says what failed and holds nothing of the file. */
function codeOf(error: unknown): string {
  if (error instanceof NotArrivedError) return 'missing';
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z]{1,64}$/.test(name) ? name : 'unknown';
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function assetJob(deps: AssetJobDeps): JobHandler<'asset'> {
  const processingOf = deps.processing ?? assetProcessing;
  return async ({ jobId, payload, db, lastAttempt }) => {
    const rows = processingOf(db);
    const ctx: WorkspaceCtx = { workspaceId: payload.workspaceId };
    const said = (event: string, fields: Record<string, string | boolean> = {}) => {
      deps.log(event, { jobId, assetId: payload.assetId, ...fields });
    };

    let loaded: AssetToProcess | undefined;
    try {
      const found = await rows.load({ brandId: payload.brandId, assetId: payload.assetId });
      if ('skip' in found) {
        said('asset.skipped', { reason: found.skip });
        return;
      }
      loaded = found.asset;
      const outcome = await processFile(deps.storage, ctx, loaded);
      if ('refused' in outcome) {
        const rejected = await rows.reject(loaded.id, outcome.reason);
        said(rejected ? 'asset.rejected' : 'asset.skipped', {
          reason: rejected ? outcome.refused : 'processed',
        });
        return;
      }
      const { finished, duplicateOf } = await rows.finish(loaded.id, outcome.file);
      if (finished) {
        said('asset.processed', { file: outcome.type, duplicate: duplicateOf !== null });
      } else {
        said('asset.skipped', { reason: 'processed' });
      }
    } catch (error) {
      // Rethrown as its code only: a store's or the database's message may hold the key, or the text being saved.
      const code = codeOf(error);
      if (lastAttempt && loaded !== undefined) {
        const reason = code === 'missing' ? NEVER_ARRIVED : FAILED;
        const rejected = await rows.reject(loaded.id, reason).catch(() => false);
        said(rejected ? 'asset.rejected' : 'asset.failed', { reason: code, error: code });
      } else {
        said('asset.retry', { error: code });
      }
      throw new Error(`asset job failed (${code})`);
    }
  };
}

/** Steps 2 and 3: what processing found, with the picture's files written; or why the file is refused. */
async function processFile(
  storage: Pick<Storage, 'get' | 'put'>,
  ctx: WorkspaceCtx,
  target: AssetToProcess,
): Promise<{ file: ProcessedFile; type: 'image' | 'pdf' } | Refusal> {
  let bytes: Uint8Array | null;
  try {
    bytes = await storage.get(
      ctx,
      assetKey(ctx, { brandId: target.brandId, assetId: target.id, variant: 'original' }),
      { maxBytes: MAX_FILE_BYTES },
    );
  } catch (error) {
    if (error instanceof UploadLimitError) return { refused: 'too-large', reason: TOO_LARGE };
    throw error;
  }
  if (bytes === null) throw new NotArrivedError();

  if (isPdf(bytes)) {
    // §06: a PDF is read for its text; a picture is a JPG, PNG, WebP or SVG.
    if (target.kind !== 'document')
      return { refused: 'pdf-not-document', reason: PDF_NOT_DOCUMENT };
    try {
      const { text } = await readPdfText(bytes);
      return {
        type: 'pdf',
        file: {
          sha256: sha256(bytes),
          perceptualHash: null,
          sizeBytes: bytes.byteLength,
          extractedText: text,
        },
      };
    } catch (error) {
      if (error instanceof PdfRefusedError) return { refused: error.reason, reason: error.message };
      throw error;
    }
  }

  let set;
  try {
    set = await processImage(bytes);
  } catch (error) {
    if (error instanceof ImageRefusedError) {
      if (target.kind === 'document' && error.reason === 'not-an-image') {
        return { refused: 'not-a-document', reason: NOT_A_DOCUMENT };
      }
      return { refused: error.reason, reason: error.message };
    }
    throw error;
  }
  await saveImageSet(storage, ctx, { brandId: target.brandId, assetId: target.id }, set);
  const files = Object.values(set.files);
  return {
    type: 'image',
    file: {
      sha256: set.sha256,
      perceptualHash: set.perceptualHash,
      sizeBytes: files.reduce((total, each) => total + each.data.byteLength, 0),
      extractedText: null,
    },
  };
}

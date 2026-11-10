// The file store client (§13 File storage): an S3 client for SeaweedFS in development and R2 in production, which only
// ever makes signed links. The browser never gets the keys, only a link for one file in one workspace that stops
// working soon: 15 minutes, or 7 days for an export download (§12). Signing needs no network, so it's fast and tested
// offline; the clock is injected so tests can sign in the past.
//
// Uploads are signed PUT links, not browser POST forms (S3's presigned POST): R2 takes presigned PUTs but not POST
// uploads. The link signs the `content-type` and `content-length` headers, so the store refuses a PUT with another
// type or another size than the one the link was made for; the size limit is enforced by never signing a size over
// the caller's limit. (Whether R2 enforces a signed content-length the way S3 and SeaweedFS do is still to check
// when R2 credentials exist; the worker re-checks every upload's real size and content in any case, §10.)
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { WorkspaceCtx } from '@lzp/db';
import { keyKind, StorageKeyError } from './keys.ts';

/** The file store's settings, named as in `config/env.ts`. */
export interface StorageSettings {
  readonly STORAGE_ENDPOINT: string;
  readonly STORAGE_REGION: string;
  readonly STORAGE_BUCKET: string;
  readonly STORAGE_ACCESS_KEY_ID: string;
  readonly STORAGE_SECRET_ACCESS_KEY: string;
}

/** What an upload may be: the caller decides (§10), this package enforces. */
export interface UploadLimits {
  readonly maxBytes: number;
  /** Exact MIME types, lowercase, no parameters: `image/jpeg`. */
  readonly contentTypes: readonly string[];
}

export interface UploadRequest {
  readonly contentType: string;
  /** The file's exact size in bytes; the link accepts a body of exactly this size. */
  readonly size: number;
}

export interface SignedUpload {
  readonly method: 'PUT';
  readonly url: string;
  /** Headers the browser must send as they are; the link is signed for them. */
  readonly headers: Readonly<Record<'content-type' | 'content-length', string>>;
  readonly expiresAt: Date;
}

export interface SignedDownload {
  readonly url: string;
  readonly expiresAt: Date;
}

/** A file that breaks the limits the caller set. The message is safe to show. */
export class UploadLimitError extends Error {
  override readonly name = 'UploadLimitError';
}

export interface Storage {
  /** A link for the browser to PUT one file of the given type and size to an asset's `original` key. Refuses any other key. */
  signUpload: (
    ctx: WorkspaceCtx,
    key: string,
    upload: UploadRequest,
    limits: UploadLimits,
  ) => Promise<SignedUpload>;
  /** A link to read `key`: 15 minutes, or 7 days with `{ export: true }`, for an export file only. Refuses a key outside the workspace. */
  signDownload: (
    ctx: WorkspaceCtx,
    key: string,
    options?: { export?: boolean },
  ) => Promise<SignedDownload>;
  close: () => void;
}

const SECOND = 1000;
/** §13: downloads last 15 minutes; an upload link follows the same rule. */
export const LINK_SECONDS = 15 * 60;
/** §13, §12: an export download link lasts 7 days. */
export const EXPORT_LINK_SECONDS = 7 * 24 * 60 * 60;

export function createStorage(
  settings: StorageSettings,
  options: { now?: () => Date } = {},
): Storage {
  const now = options.now ?? (() => new Date());
  const bucket = settings.STORAGE_BUCKET;
  const client = new S3Client({
    endpoint: settings.STORAGE_ENDPOINT,
    region: settings.STORAGE_REGION,
    credentials: {
      accessKeyId: settings.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: settings.STORAGE_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true, // SeaweedFS and R2 both take bucket-in-path; no wildcard DNS needed
    // Without this the SDK adds a checksum of the (empty) body to the link, which no real upload matches.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

  return {
    async signUpload(ctx, key, upload, limits) {
      // Only a browser upload of an asset's original goes through a signed PUT. A render, an export or a resized copy
      // is written by the worker, and a link must never let a browser replace one.
      if (keyKind(ctx, key) !== 'original') {
        throw new StorageKeyError('a link can only upload an asset original');
      }
      if (!Number.isSafeInteger(upload.size) || upload.size <= 0) {
        throw new UploadLimitError('The file size must be a whole number of bytes above 0.');
      }
      if (upload.size > limits.maxBytes) throw new UploadLimitError('The file is too large.');
      if (!limits.contentTypes.includes(upload.contentType)) {
        throw new UploadLimitError("That file type isn't allowed.");
      }
      const signingDate = now();
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: upload.contentType,
          ContentLength: upload.size,
        }),
        {
          expiresIn: LINK_SECONDS,
          signingDate,
          // Signed headers are enforced by the store: another type or size makes the signature fail.
          signableHeaders: new Set(['content-type', 'content-length']),
        },
      );
      return {
        method: 'PUT',
        url,
        headers: { 'content-type': upload.contentType, 'content-length': String(upload.size) },
        expiresAt: new Date(signingDate.getTime() + LINK_SECONDS * SECOND),
      };
    },

    async signDownload(ctx, key, downloadOptions = {}) {
      const kind = keyKind(ctx, key);
      // 7 days is for export downloads only (§13); anything else, a raw upload included, lives for 15 minutes.
      if (downloadOptions.export === true && kind !== 'export') {
        throw new StorageKeyError('only an export file gets a 7-day link');
      }
      const seconds = downloadOptions.export === true ? EXPORT_LINK_SECONDS : LINK_SECONDS;
      const signingDate = now();
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: seconds,
        signingDate,
      });
      return { url, expiresAt: new Date(signingDate.getTime() + seconds * SECOND) };
    },

    close() {
      client.destroy();
    },
  };
}

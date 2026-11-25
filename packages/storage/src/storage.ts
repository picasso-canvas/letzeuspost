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
//
// The worker reads and writes objects itself (`get`, `put`, `head`, `delete`). Each checks its key with `keyKind` before
// any request, like signing does, so the worker too reaches only the context's workspace and only §13's key shapes.
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
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
  /**
   * The worker reads `key`; `null` when there is no such file. Refuses (`UploadLimitError`) a file over `maxBytes`
   * without reading past the cap: an upload is untrusted until checked (§10).
   */
  get: (
    ctx: WorkspaceCtx,
    key: string,
    options: { maxBytes: number },
  ) => Promise<Uint8Array | null>;
  /** The worker writes `key`, replacing any file there. */
  put: (ctx: WorkspaceCtx, key: string, body: Uint8Array, contentType: string) => Promise<void>;
  /** The size and type of `key`; `null` when there is no such file. */
  head: (ctx: WorkspaceCtx, key: string) => Promise<ObjectInfo | null>;
  /** The worker deletes `key`; deleting a file that isn't there is not an error. */
  delete: (ctx: WorkspaceCtx, key: string) => Promise<void>;
  close: () => void;
}

export interface ObjectInfo {
  readonly size: number;
  readonly contentType: string | undefined;
}

const SECOND = 1000;
/** §13: downloads last 15 minutes; an upload link follows the same rule. */
export const LINK_SECONDS = 15 * 60;
/** §13, §12: an export download link lasts 7 days. */
export const EXPORT_LINK_SECONDS = 7 * 24 * 60 * 60;

/** Whether the store answered that there is no such file. */
function isMissing(error: unknown): boolean {
  return error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404;
}

/** Reads a file's body whole, but stops and refuses it as soon as it passes `maxBytes`. */
async function readCapped(body: unknown, maxBytes: number): Promise<Uint8Array> {
  if (!(body instanceof Readable)) throw new Error('the file store sent no readable body');
  const chunks: Buffer[] = [];
  let total = 0;
  // Leaving the loop early (the throw) destroys the stream, so nothing past the cap is read.
  for await (const chunk of body) {
    if (!Buffer.isBuffer(chunk)) throw new Error('the file store sent a body that is not bytes');
    total += chunk.length;
    if (total > maxBytes) throw new UploadLimitError('The file is too large.');
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

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

    async get(ctx, key, { maxBytes }) {
      keyKind(ctx, key);
      if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new RangeError('maxBytes must be a whole number of bytes above 0');
      }
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return await readCapped(response.Body, maxBytes);
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async put(ctx, key, body, contentType) {
      keyKind(ctx, key);
      // §13: an SVG is only ever loaded as an image. The worker rasterises it (images.ts) and never stores one, so no
      // signed link can serve a script from the bucket.
      if (contentType.split(';')[0]?.trim().toLowerCase() === 'image/svg+xml') {
        throw new UploadLimitError('An SVG is never stored as SVG.');
      }
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async head(ctx, key) {
      keyKind(ctx, key);
      try {
        const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        if (response.ContentLength === undefined) throw new Error('the file store sent no size');
        return { size: response.ContentLength, contentType: response.ContentType };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async delete(ctx, key) {
      keyKind(ctx, key);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    close() {
      client.destroy();
    },
  };
}

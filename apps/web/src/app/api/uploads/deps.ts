// The upload route's real dependencies (#403): the guard, the member's rate limit in Postgres as the app role, the
// round's rules and the plan's storage limit from @lzp/core with config/plans.ts, the rows and their jobs, and the
// signer's limits. The process's handles (the database, the queue, the file store) are passed in. Each step's order
// and answers are the handler's (handler.ts).
import { guard } from '@lzp/auth';
import { plans } from '@lzp/config';
import {
  checkStorage,
  checkUploadRound,
  MAX_UPLOAD_BYTES,
  storagePlans,
  UPLOAD_TYPES,
} from '@lzp/core';
import {
  hitWorkspaceRateLimit,
  startUploads,
  type Db,
  type QuotaAnswer,
  type SendAssetJob,
  type StorageUse,
  type WorkspaceCtx,
} from '@lzp/db';
import {
  UPLOAD_ROUNDS_PER_WINDOW,
  UPLOAD_WINDOW_SECONDS,
  type FileToSign,
  type SignedUploadLink,
  type UploadsDeps,
} from './handler.ts';

/**
 * The file store's signer: the part of @lzp/storage's `Storage` the route uses, which a `createStorage(…)` is. Named
 * here, not imported: apps/web doesn't type-check @lzp/storage's source yet (#403's PR, needs-zeus).
 */
export interface UploadSigner {
  readonly signUpload: (
    ctx: WorkspaceCtx,
    key: string,
    upload: FileToSign,
    limits: { readonly maxBytes: number; readonly contentTypes: readonly string[] },
  ) => Promise<SignedUploadLink>;
}

/**
 * Whether a round's bytes fit the workspace's plan (§02 Running out, and limits): its storage from config/plans.ts,
 * and, past it, the message that names the next plan. A workspace with no plan yet is held to Starter's 10 GB (Zeus,
 * 2026-11-26, on #403); a plan config/plans.ts doesn't know is an error, never a guessed limit.
 */
export function storageQuota(use: StorageUse): QuotaAnswer {
  return checkStorage({
    ...storagePlans(plans, use.plan),
    usedBytes: use.usedBytes,
    addingBytes: use.addingBytes,
  });
}

export interface UploadsServices {
  /** APP_URL's origin. */
  readonly appOrigin: string;
  /** The app role's handle (DATABASE_URL): row-level security applies. */
  readonly db: Db;
  /** Queues an `asset` job in the rows' own transaction. */
  readonly send: SendAssetJob;
  readonly storage: UploadSigner;
}

/** The handler's dependencies on these handles; failures are logged by the handler's own default (a step and a code). */
export function uploadsDeps({ appOrigin, db, send, storage }: UploadsServices): UploadsDeps {
  return {
    appOrigin,
    guard: (headers, action) => guard().check(headers, action),
    // One bucket per member, in the workspace the session is in; the table and its lock are the app role's own.
    rateLimit: (ctx, userId) =>
      hitWorkspaceRateLimit(
        db,
        ctx,
        `uploads:${userId}`,
        UPLOAD_ROUNDS_PER_WINDOW,
        UPLOAD_WINDOW_SECONDS,
      ),
    checkRound: checkUploadRound,
    start: (ctx, round) => startUploads(db, send, ctx, round, storageQuota),
    // Each link is signed for its file's type and size, and refused past §06's types and 20 MB.
    sign: (ctx, key, file) =>
      storage.signUpload(ctx, key, file, {
        maxBytes: MAX_UPLOAD_BYTES,
        contentTypes: UPLOAD_TYPES,
      }),
  };
}

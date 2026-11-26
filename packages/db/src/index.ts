// @lzp/db: the scoped helper, the migrations and the workspace tables. The raw client never leaves this package;
// packages/auth has its own handle in `@lzp/db/auth` (Q5). Better Auth's tables (user, session, account, verification)
// are exported only from there (#176): workspace code has no use for them, and its role can't reach them anyway.
export { createDb, type Db, type Scoped, type Tx, type WorkspaceCtx } from './db.ts';
export { migrate } from './migrate.ts';
export { invitation, member, roles, workspace } from './schema.ts';
export { emailMessage, emailStatuses, type EmailStatus } from './schema/email-message.ts';
// Brands and their kit versions (#399): a kit is saved only through `brandKits(db, BrandKitSchema).saveKit`.
export { approvalModes, brand, brandKitVersion, type ApprovalMode } from './schema/brands.ts';
export {
  brandKits,
  type BrandKits,
  type KitSchema,
  type KitVersion,
  type NewBrand,
} from './brand-kits.ts';
// A brand's library (#400): a row per file, `waiting` until the `asset` job has processed it.
export {
  asset,
  assetKinds,
  assetSources,
  assetStatuses,
  type AssetKind,
  type AssetSource,
  type AssetStatus,
} from './schema/assets.ts';
// Jobs (§13, Q7): the queues and how a job sets its workspace live here; the handlers live in apps/worker.
export {
  createJobs,
  installJobs,
  JOBS_SCHEMA,
  type JobContext,
  type JobHandler,
  type Jobs,
  type JobsOptions,
} from './jobs/boss.ts';
export {
  emailOutbox,
  INTERRUPTED,
  queueEmail,
  SENDING_STALE_AFTER_SECONDS,
  type EmailOutbox,
  type NewEmail,
  type OutboxEmail,
  type OutboxSkip,
} from './jobs/email-outbox.ts';
// The `asset` job's steps (#402): an upload processed or rejected, and marked when it looks like an earlier one.
export {
  ASSET_FINISH_LOCK,
  assetProcessing,
  DUPLICATE_MAX_BITS,
  type AssetProcessing,
  type AssetSkip,
  type AssetToProcess,
  type ProcessedFile,
} from './jobs/asset-processing.ts';
export {
  checkPayload,
  JobPayloadError,
  queueNames,
  type Payload,
  type QueueName,
} from './jobs/queues.ts';

// An upload round's rows (#403, §13 File storage and The app's API, §06 Reading uploaded files, §02 Running out, and
// limits): before the browser gets its signed links, each file becomes a `waiting` asset of the member's brand, with
// its own key, and its `asset` job is queued in the same transaction, so a row never waits without a job and a job
// never names a row that isn't there. The job retries until the file has arrived, and rejects the asset with a plain
// reason if it never does.
//
// The storage limit is checked here, with the workspace's row locked, so two rounds at once can't both pass it (as
// `createBrand` does for brands). The rule and its "next plan" message are @lzp/core's `checkStorage` with the plan
// from config/plans.ts, which this package doesn't depend on: the app passes them in (`quota`). What a workspace
// stores is the sum of its assets' sizes. A new row holds the size the browser declared (the signed link allows that
// size and no other), so files still on their way count; the job replaces it with the processed files' size.
import { randomUUIDv7 } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { checkedId, type Db, type Tx, type WorkspaceCtx } from './db.ts';
import type { Payload } from './jobs/queues.ts';
import { workspace } from './schema/accounts.ts';
import { asset, type AssetKind } from './schema/assets.ts';
import { brand } from './schema/brands.ts';

/** One file of the round: what it is, and the size its signed link will allow. */
export interface NewUpload {
  readonly kind: AssetKind;
  readonly sizeBytes: number;
}

export interface UploadRound {
  readonly brandId: string;
  /** The signed-in member uploading; their id comes from the session, never from the request. */
  readonly uploadedBy: string;
  readonly files: readonly NewUpload[];
}

/** What the quota is asked: the workspace's plan (null until billing sets it), what it stores, and what is added. */
export interface StorageUse {
  readonly plan: string | null;
  readonly usedBytes: number;
  readonly addingBytes: number;
}

/** The quota's answer: @lzp/core's `checkStorage` gives one. */
export type QuotaAnswer = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** Queues an `asset` job in `tx` (`jobs.send('asset', payload, { tx })`). */
export type SendAssetJob = (payload: Payload<'asset'>, options: { tx: Tx }) => Promise<string>;

export type StartedUploads =
  | { readonly started: readonly { readonly assetId: string; readonly storageKey: string }[] }
  /** The brand isn't this workspace's (another's, or none): nothing was added. */
  | { readonly refused: 'no-brand' }
  /** Past the plan's storage: nothing was added; `message` says so and names the next plan. */
  | { readonly refused: 'storage'; readonly message: string };

/** §13's key of an asset's original (@lzp/storage's `assetKey`); the table's check holds every row to it. */
const originalKey = (workspaceId: string, brandId: string, assetId: string) =>
  `ws/${workspaceId}/brands/${brandId}/assets/${assetId}/original`;

/**
 * Adds a `waiting` asset per file of the round and queues its job, all in one transaction, if the brand is this
 * workspace's and `quota` allows the round's bytes on top of what the workspace stores. Either every file is added,
 * or none is. The caller has already checked the round's own limits (types, sizes, count: `checkUploadRound`).
 */
export async function startUploads(
  db: Db,
  send: SendAssetJob,
  ctx: WorkspaceCtx,
  round: UploadRound,
  quota: (use: StorageUse) => QuotaAnswer,
): Promise<StartedUploads> {
  const workspaceId = checkedId('workspace', ctx.workspaceId);
  const brandId = checkedId('brand', round.brandId);
  const uploadedBy = checkedId('user', round.uploadedBy);
  if (round.files.length === 0) throw new Error('startUploads: a round has at least one file');
  for (const file of round.files) {
    if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0) {
      throw new Error('startUploads: a file’s size is a whole number of bytes, 1 or more');
    }
  }
  const addingBytes = round.files.reduce((total, file) => total + file.sizeBytes, 0);

  return db.forWorkspace(ctx).transaction(async (tx) => {
    // NO KEY UPDATE: it waits for another round in this workspace, not for rows that only point at the workspace.
    const [space] = await tx
      .select({ plan: workspace.plan })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .for('no key update');
    if (space === undefined) throw new Error('startUploads: the workspace is not there');
    const [found] = await tx.select({ id: brand.id }).from(brand).where(eq(brand.id, brandId));
    if (found === undefined) return { refused: 'no-brand' } as const;

    const [stored] = await tx
      .select({ bytes: sql<string>`coalesce(sum(${asset.sizeBytes}), 0)::text` })
      .from(asset);
    const usedBytes = Number(stored?.bytes ?? '0');
    const answer = quota({ plan: space.plan, usedBytes, addingBytes });
    if (!answer.ok) return { refused: 'storage', message: answer.message } as const;

    const rows = round.files.map((file) => {
      const id = randomUUIDv7();
      return {
        id,
        workspaceId,
        brandId,
        kind: file.kind,
        storageKey: originalKey(workspaceId, brandId, id),
        sizeBytes: file.sizeBytes,
        status: 'waiting' as const,
        source: 'own' as const,
        uploadedBy,
      };
    });
    await tx.insert(asset).values(rows);
    for (const row of rows) {
      await send({ workspaceId, brandId, assetId: row.id }, { tx });
    }
    return { started: rows.map((row) => ({ assetId: row.id, storageKey: row.storageKey })) };
  });
}

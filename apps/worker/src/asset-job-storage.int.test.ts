// The `asset` job and the plan's storage, against real Postgres and a real S3 server (SeaweedFS), in
// `pnpm check:services` and CI's `services` job (#403, Cerberus F1 on #439, Zeus's decision 1(a) of 2026-11-28 on
// #403): a rejected asset no longer counts against the plan's storage (packages/db's `startUploads`), so its files
// leave the bucket first. A file that arrived and was refused, and one that never arrived, both end with no key left
// and the workspace's stored bytes back to what they were.
//
// The handler runs here directly, with the job context `createJobs` gives it, not through the queue, as in
// ./asset.int.test.ts. The workspace, its rows and files are this run's; the files are deleted and the workspace goes
// at the end, its rows with it.
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { loadEnv } from '@lzp/config';
import {
  asset,
  brand,
  createDb,
  migrate,
  startUploads,
  workspace,
  type Db,
  type JobContext,
  type WorkspaceCtx,
} from '@lzp/db';
import { assetKey, createStorage, type AssetVariant } from '@lzp/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetJob } from './asset-job.ts';

const env = loadEnv('worker');
const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');
const run = randomUUID();
const storage = createStorage(env);
const handler = assetJob({ storage, log: () => undefined });

const VARIANTS = ['original', '1600', '360'] as const satisfies readonly AssetVariant[];

let db: Db;
let ctx: WorkspaceCtx;
let brandId: string;
const made: string[] = [];

beforeAll(async () => {
  await migrate(ownerUrl);
  db = createDb(env.DATABASE_URL);
  ctx = { workspaceId: randomUUIDv7() };
  const [created] = await db.forWorkspace(ctx).transaction(async (tx) => {
    await tx.insert(workspace).values({
      id: ctx.workspaceId,
      name: `Asset storage ${run}`,
      slug: `asset-storage-${run}`,
    });
    return tx
      .insert(brand)
      .values({ workspaceId: ctx.workspaceId, nameEn: 'Golpo Cafe' })
      .returning({ id: brand.id });
  });
  if (created === undefined) throw new Error('no brand');
  brandId = created.id;
}, 60_000);

afterAll(async () => {
  for (const key of made) await storage.delete(ctx, key);
  await db.forWorkspace(ctx).transaction(async (tx) => {
    await tx.delete(workspace); // row-level security: only this run's workspace; its brand and assets go with it
  });
  await db.close();
  storage.close();
});

const keyOf = (assetId: string, variant: AssetVariant) =>
  assetKey(ctx, { brandId, assetId, variant });

/** A waiting row as the upload route adds it, holding the size the browser declared. */
async function waiting(kind: 'photo' | 'document', sizeBytes: number): Promise<string> {
  const id = randomUUIDv7();
  for (const variant of VARIANTS) made.push(keyOf(id, variant));
  await db.forWorkspace(ctx).transaction((tx) =>
    tx.insert(asset).values({
      id,
      workspaceId: ctx.workspaceId,
      brandId,
      kind,
      source: 'own',
      storageKey: keyOf(id, 'original'),
      sizeBytes,
    }),
  );
  return id;
}

/** One run of the asset's job, as pg-boss hands it over. */
const jobFor = (assetId: string, change: Partial<JobContext<'asset'>> = {}) =>
  handler({
    jobId: randomUUID(),
    payload: { workspaceId: ctx.workspaceId, brandId, assetId },
    db: db.forWorkspace(ctx),
    retryCount: 0,
    lastAttempt: false,
    ...change,
  });

/** What the upload route's quota is told the workspace stores (packages/db's startUploads); adds nothing. */
async function usedBytes(): Promise<number> {
  let seen: number | undefined;
  const answer = await startUploads(
    db,
    () => Promise.reject(new Error('no job is queued here')),
    ctx,
    { brandId, uploadedBy: randomUUIDv7(), files: [{ kind: 'photo', sizeBytes: 1 }] },
    (use) => {
      seen = use.usedBytes;
      return { ok: false, message: 'only measuring' };
    },
  );
  if (seen === undefined || !('refused' in answer)) throw new Error('the quota was not asked');
  return seen;
}

/** The asset's row status and reason, read in the workspace. */
async function rowOf(assetId: string) {
  const rows = await db
    .forWorkspace(ctx)
    .transaction((tx) =>
      tx
        .select({ id: asset.id, status: asset.status, rejectReason: asset.rejectReason })
        .from(asset),
    );
  return rows.find((row) => row.id === assetId);
}

/** Each of the asset's keys as the bucket holds it: its size, or null when there is no file. */
const filesOf = (assetId: string) =>
  Promise.all(
    VARIANTS.map(
      async (variant) => (await storage.head(ctx, keyOf(assetId, variant)))?.size ?? null,
    ),
  );

describe('a rejected asset’s files and the plan’s storage', { timeout: 60_000 }, () => {
  it('deletes a file that arrived and was refused as no PDF or picture, and it stops counting', async () => {
    const before = await usedBytes();
    const junk = Buffer.from(`not a picture ${run} `.repeat(1000));
    const id = await waiting('document', junk.byteLength);
    // The browser's PUT, through its signed link: random bytes, sent as a PNG.
    await storage.put(ctx, keyOf(id, 'original'), junk, 'image/png');
    expect(await filesOf(id)).toEqual([junk.byteLength, null, null]);
    expect(await usedBytes()).toBe(before + junk.byteLength);

    await jobFor(id);
    expect(await rowOf(id)).toEqual({
      id,
      status: 'rejected',
      rejectReason: "That file isn't a PDF or a JPG, PNG, WebP or SVG image.",
    });
    expect(await filesOf(id)).toEqual([null, null, null]);
    expect(await usedBytes()).toBe(before);
  });

  it('leaves no key of a file that never arrived, rejected on the last try, and it stops counting', async () => {
    const before = await usedBytes();
    const id = await waiting('photo', 4096);
    expect(await usedBytes()).toBe(before + 4096);

    await expect(jobFor(id, { retryCount: 3, lastAttempt: true })).rejects.toThrow(
      'asset job failed (missing)',
    );
    expect((await rowOf(id))?.status).toBe('rejected');
    expect(await filesOf(id)).toEqual([null, null, null]);
    expect(await usedBytes()).toBe(before);
  });
});

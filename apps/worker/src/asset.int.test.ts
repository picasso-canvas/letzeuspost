// The `asset` job against real Postgres and a real S3 server (SeaweedFS), in `pnpm check:services` and CI's `services`
// job (#402, §06 Reading uploaded files and Asset library, §10 Processing every image, §13 Jobs and File storage): an
// upload becomes a ready asset with its sizes in the bucket, or a rejected one with a plain reason; running the job
// again, or after a run that died before its last write, changes nothing more; duplicates are found by sha256 and by
// perceptual hash within a brand, the newer marked and both kept; a client's photo waits for the agency; a rejected
// file leaves the bucket as it stops counting against the plan's storage; and a job of one workspace naming another's
// asset reaches nothing of it.
//
// The handler runs here directly, with the job context `createJobs` gives it, not through the queue: another services
// file's worker could take this file's jobs (as tests/tenancy/jobs.test.ts explains). Every workspace, row and file is
// this run's; the files are deleted and the workspaces go at the end, their rows with them.
import { createHash, randomUUID, randomUUIDv7 } from 'node:crypto';
import { loadEnv } from '@lzp/config';
import {
  asset,
  assetProcessing,
  brand,
  createDb,
  migrate,
  startUploads,
  workspace,
  type AssetKind,
  type AssetSource,
  type Db,
  type JobContext,
  type WorkspaceCtx,
} from '@lzp/db';
import { assetKey, createStorage, type AssetVariant } from '@lzp/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { banglaPdf, lockedPdf, textPdf } from '../../../packages/storage/src/pdf/fixtures.ts';
import { picture, touched } from './asset-fixtures.ts';
import { assetJob } from './asset-job.ts';

const env = loadEnv('worker');
const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');
const run = randomUUID();
const storage = createStorage(env);

interface Space {
  readonly ctx: WorkspaceCtx;
  readonly brandId: string;
  /** A second brand of the same workspace. */
  readonly otherBrandId: string;
}
let db: Db;
let a: Space;
let b: Space;
/** Only the rejected-file tests upload here, so what it stores moves only with them. */
let c: Space;
const made: { ctx: WorkspaceCtx; key: string }[] = [];

const VARIANTS = ['original', '1600', '360'] as const satisfies readonly AssetVariant[];

async function space(label: string): Promise<Space> {
  const ctx = { workspaceId: randomUUIDv7() };
  const brands = await db.forWorkspace(ctx).transaction(async (tx) => {
    await tx.insert(workspace).values({
      id: ctx.workspaceId,
      name: `Assets ${label} ${run}`,
      slug: `asset-job-${label}-${run}`,
    });
    return tx
      .insert(brand)
      .values([
        { workspaceId: ctx.workspaceId, nameEn: `Golpo Cafe ${label}` },
        { workspaceId: ctx.workspaceId, nameEn: `Northwind ${label}` },
      ])
      .returning({ id: brand.id });
  });
  const [first, second] = brands;
  if (first === undefined || second === undefined) throw new Error('no brands');
  return { ctx, brandId: first.id, otherBrandId: second.id };
}

beforeAll(async () => {
  await migrate(ownerUrl);
  db = createDb(env.DATABASE_URL);
  a = await space('a');
  b = await space('b');
  c = await space('c');
}, 60_000);

afterAll(async () => {
  for (const { ctx, key } of made) await storage.delete(ctx, key);
  for (const each of [a, b, c]) {
    await db.forWorkspace(each.ctx).transaction(async (tx) => {
      await tx.delete(workspace); // row-level security: only this run's workspace; its brands and assets go with it
    });
  }
  await db.close();
  storage.close();
});

const keyOf = (s: Space, brandId: string, assetId: string, variant: AssetVariant) =>
  assetKey(s.ctx, { brandId, assetId, variant });

/**
 * An asset as the upload route adds it: a waiting row, and its file at its original's key. Each is added in a
 * transaction of its own, so each is later than the one before.
 */
async function upload(
  s: Space,
  file: Uint8Array,
  {
    kind = 'photo',
    source = 'own',
    brandId = s.brandId,
    sizeBytes,
  }: { kind?: AssetKind; source?: AssetSource; brandId?: string; sizeBytes?: number } = {},
): Promise<{ id: string; brandId: string }> {
  const id = randomUUIDv7();
  for (const variant of VARIANTS) made.push({ ctx: s.ctx, key: keyOf(s, brandId, id, variant) });
  await db.forWorkspace(s.ctx).transaction((tx) =>
    tx.insert(asset).values({
      id,
      workspaceId: s.ctx.workspaceId,
      brandId,
      kind,
      source,
      storageKey: keyOf(s, brandId, id, 'original'),
      ...(sizeBytes === undefined ? {} : { sizeBytes }),
    }),
  );
  const isPdf = Buffer.from(file.subarray(0, 5)).toString('latin1') === '%PDF-';
  await storage.put(
    s.ctx,
    keyOf(s, brandId, id, 'original'),
    file,
    isPdf ? 'application/pdf' : 'image/png',
  );
  return { id, brandId };
}

const handler = assetJob({ storage, log: () => undefined });

/** One run of the asset's job in `s`'s workspace, as pg-boss hands it over. */
function jobFor(
  s: Space,
  target: { id: string; brandId: string },
  change: Partial<JobContext<'asset'>> = {},
): Promise<void> {
  return handler({
    jobId: randomUUID(),
    payload: { workspaceId: s.ctx.workspaceId, brandId: target.brandId, assetId: target.id },
    db: db.forWorkspace(s.ctx),
    retryCount: 0,
    lastAttempt: false,
    ...change,
  });
}

/** The asset's row, read in `s`'s workspace (row-level security leaves only its own rows to choose from). */
async function rowOf(s: Space, id: string) {
  const rows = await db.forWorkspace(s.ctx).transaction((tx) =>
    tx
      .select({
        id: asset.id,
        status: asset.status,
        sha256: asset.sha256,
        perceptualHash: asset.perceptualHash,
        sizeBytes: asset.sizeBytes,
        duplicateOf: asset.duplicateOf,
        rejectReason: asset.rejectReason,
        extractedText: asset.extractedText,
        updatedAt: asset.updatedAt,
      })
      .from(asset),
  );
  const row = rows.find((each) => each.id === id);
  if (row === undefined) throw new Error('no such asset in this workspace');
  return row;
}

/** Each size's file as the bucket holds it: its sha256, or null when there is none. */
async function filesOf(s: Space, target: { id: string; brandId: string }) {
  return Promise.all(
    VARIANTS.map(async (variant) => {
      const file = await storage.get(s.ctx, keyOf(s, target.brandId, target.id, variant), {
        maxBytes: 50 * 1024 * 1024,
      });
      return file === null ? null : createHash('sha256').update(file).digest('hex');
    }),
  );
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('the asset job on Postgres and SeaweedFS', { timeout: 60_000 }, () => {
  it('turns an uploaded picture into a ready asset: its three sizes in the bucket, its hashes and size in the row', async () => {
    const photo = await upload(a, picture(11));
    await jobFor(a, photo);

    const row = await rowOf(a, photo.id);
    const sizes = await Promise.all(
      VARIANTS.map((variant) => storage.head(a.ctx, keyOf(a, photo.brandId, photo.id, variant))),
    );
    expect(sizes.map((size) => size?.contentType)).toEqual([
      'image/png',
      'image/webp',
      'image/webp',
    ]);
    const [original] = await filesOf(a, photo);
    expect(row).toMatchObject({
      status: 'ready',
      sha256: original,
      perceptualHash: expect.stringMatching(/^[0-9a-f]{16}$/) as unknown,
      sizeBytes: sizes.reduce((total, size) => total + (size?.size ?? 0), 0),
      duplicateOf: null,
      rejectReason: null,
      extractedText: null,
    });
  });

  it('changes nothing when the job runs again: the row, its time and the files stay as they were', async () => {
    const photo = await upload(a, picture(12));
    await jobFor(a, photo);
    const before = { row: await rowOf(a, photo.id), files: await filesOf(a, photo) };

    await jobFor(a, photo);
    await jobFor(a, photo, { retryCount: 1, lastAttempt: true });
    expect(await rowOf(a, photo.id)).toEqual(before.row);
    expect(await filesOf(a, photo)).toEqual(before.files);
  });

  it('finishes a job whose earlier run died after writing the files, once', async () => {
    const photo = await upload(a, picture(13));
    const dies = assetJob({
      storage,
      log: () => undefined,
      processing: (scoped) => ({
        ...assetProcessing(scoped),
        finish: () => Promise.reject(new Error('Connection terminated unexpectedly')),
      }),
    });
    await expect(
      dies({
        jobId: randomUUID(),
        payload: { workspaceId: a.ctx.workspaceId, brandId: photo.brandId, assetId: photo.id },
        db: db.forWorkspace(a.ctx),
        retryCount: 0,
        lastAttempt: false,
      }),
    ).rejects.toThrow('asset job failed');
    expect((await rowOf(a, photo.id)).status).toBe('waiting');

    await jobFor(a, photo, { retryCount: 1 });
    const row = await rowOf(a, photo.id);
    expect(row.status).toBe('ready');
    const [original] = await filesOf(a, photo);
    expect(row.sha256).toBe(original);
  });

  it('keeps a PDF document’s text, Bangla included, and draws no copies of it', async () => {
    const pdf = banglaPdf();
    const document = await upload(a, pdf, { kind: 'document' });
    await jobFor(a, document);

    expect(await rowOf(a, document.id)).toMatchObject({
      status: 'ready',
      sha256: sha256(pdf),
      perceptualHash: null,
      sizeBytes: pdf.byteLength,
      extractedText: 'বাংলা',
      rejectReason: null,
    });
    const [original, large, small] = await filesOf(a, document);
    expect(original).toBe(sha256(pdf));
    expect([large, small]).toEqual([null, null]);
  });

  it('rejects a hostile PDF with a plain reason, and a rerun leaves it so', async () => {
    const locked = await upload(a, lockedPdf(), { kind: 'document' });
    await jobFor(a, locked);
    const row = await rowOf(a, locked.id);
    expect(row).toMatchObject({
      status: 'rejected',
      rejectReason: 'This PDF is protected by a password. Please upload a copy without one.',
      sha256: null,
      extractedText: null,
    });
    await jobFor(a, locked);
    expect(await rowOf(a, locked.id)).toEqual(row);
  });

  it('rejects a PDF given as a photo', async () => {
    const pdf = await upload(a, textPdf(['Golpo Cafe menu']), { kind: 'photo' });
    await jobFor(a, pdf);
    expect(await rowOf(a, pdf.id)).toMatchObject({ status: 'rejected', extractedText: null });
  });

  it('keeps a client’s photo waiting for the agency’s approval once it is processed (§10)', async () => {
    const photo = await upload(a, picture(14), { source: 'client' });
    await jobFor(a, photo);
    const row = await rowOf(a, photo.id);
    expect(row.status).toBe('waiting');
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    await jobFor(a, photo);
    expect(await rowOf(a, photo.id)).toEqual(row);
  });
});

describe('duplicates (§06, §10; Zeus, 2026-11-25: both are kept)', { timeout: 60_000 }, () => {
  it('marks the same file uploaded again as a possible duplicate of the first, by sha256', async () => {
    const first = await upload(a, picture(21));
    const again = await upload(a, picture(21));
    await jobFor(a, first);
    await jobFor(a, again);

    expect(await rowOf(a, first.id)).toMatchObject({ status: 'ready', duplicateOf: null });
    const row = await rowOf(a, again.id);
    expect(row).toMatchObject({ status: 'ready', duplicateOf: first.id });
    expect(row.sha256).toBe((await rowOf(a, first.id)).sha256);
  });

  it('marks a nearly identical picture by its perceptual hash, and not a different one', async () => {
    const first = await upload(a, picture(22));
    const near = await upload(a, touched(22));
    const other = await upload(a, picture(23));
    for (const each of [first, near, other]) await jobFor(a, each);

    const nearRow = await rowOf(a, near.id);
    expect(nearRow.sha256).not.toBe((await rowOf(a, first.id)).sha256);
    expect(nearRow.duplicateOf).toBe(first.id);
    expect((await rowOf(a, other.id)).duplicateOf).toBeNull();
  });

  it('marks the newer of the two when the newer one was processed first', async () => {
    const older = await upload(a, picture(24));
    const newer = await upload(a, picture(24));
    await jobFor(a, newer);
    expect((await rowOf(a, newer.id)).duplicateOf).toBeNull();

    await jobFor(a, older);
    expect((await rowOf(a, older.id)).duplicateOf).toBeNull();
    expect((await rowOf(a, newer.id)).duplicateOf).toBe(older.id);
  });

  it('points every later copy at the earliest one', async () => {
    const first = await upload(a, picture(25));
    const second = await upload(a, picture(25));
    const third = await upload(a, picture(25));
    for (const each of [first, second, third]) await jobFor(a, each);
    expect((await rowOf(a, second.id)).duplicateOf).toBe(first.id);
    expect((await rowOf(a, third.id)).duplicateOf).toBe(first.id);
  });

  it('looks only within the brand: the same file in another brand or another workspace is no duplicate', async () => {
    const first = await upload(a, picture(26));
    await jobFor(a, first);
    const otherBrand = await upload(a, picture(26), { brandId: a.otherBrandId });
    const otherWorkspace = await upload(b, picture(26));
    await jobFor(a, otherBrand);
    await jobFor(b, otherWorkspace);
    expect((await rowOf(a, otherBrand.id)).duplicateOf).toBeNull();
    expect((await rowOf(b, otherWorkspace.id)).duplicateOf).toBeNull();
  });

  it('never marks a rejected file, nor one against it', async () => {
    const rejected = await upload(a, lockedPdf(), { kind: 'document' });
    await jobFor(a, rejected);
    const again = await upload(a, lockedPdf(), { kind: 'document' });
    await jobFor(a, again);
    expect((await rowOf(a, again.id)).duplicateOf).toBeNull();
    expect((await rowOf(a, rejected.id)).duplicateOf).toBeNull();
  });
});

describe(
  'a rejected file (Cerberus F1 on #439, Zeus’s decision 1(a), 2026-11-28)',
  { timeout: 60_000 },
  () => {
    /** What the workspace stores as the upload route's quota is told it (packages/db's startUploads); adds nothing. */
    async function usedBytes(s: Space): Promise<number> {
      let seen: number | undefined;
      const answer = await startUploads(
        db,
        () => Promise.reject(new Error('no job is queued here')),
        s.ctx,
        {
          brandId: s.brandId,
          uploadedBy: randomUUIDv7(),
          files: [{ kind: 'photo', sizeBytes: 1 }],
        },
        (use) => {
          seen = use.usedBytes;
          return { ok: false, message: 'only measuring' };
        },
      );
      if (seen === undefined || !('refused' in answer)) throw new Error('the quota was not asked');
      return seen;
    }

    it('leaves the bucket and stops counting: a file that arrived and was refused as no PDF or picture', async () => {
      const before = await usedBytes(c);
      const junk = Buffer.from(`not a picture ${run}`.repeat(1000));
      const file = await upload(c, junk, { kind: 'document', sizeBytes: junk.byteLength });
      expect(await storage.head(c.ctx, keyOf(c, file.brandId, file.id, 'original'))).toEqual({
        size: junk.byteLength,
        contentType: 'image/png',
      });
      expect(await usedBytes(c)).toBe(before + junk.byteLength);

      await jobFor(c, file);
      expect(await rowOf(c, file.id)).toMatchObject({
        status: 'rejected',
        rejectReason: "That file isn't a PDF or a JPG, PNG, WebP or SVG image.",
      });
      expect(await filesOf(c, file)).toEqual([null, null, null]);
      expect(await usedBytes(c)).toBe(before);
    });

    it('leaves no key behind for a file that never arrived, rejected on the last try', async () => {
      const before = await usedBytes(c);
      const id = randomUUIDv7();
      for (const variant of VARIANTS) {
        made.push({ ctx: c.ctx, key: keyOf(c, c.brandId, id, variant) });
      }
      await db.forWorkspace(c.ctx).transaction((tx) =>
        tx.insert(asset).values({
          id,
          workspaceId: c.ctx.workspaceId,
          brandId: c.brandId,
          kind: 'photo',
          source: 'own',
          storageKey: keyOf(c, c.brandId, id, 'original'),
          sizeBytes: 4096,
        }),
      );
      expect(await usedBytes(c)).toBe(before + 4096);

      const missing = { id, brandId: c.brandId };
      await expect(jobFor(c, missing, { retryCount: 3, lastAttempt: true })).rejects.toThrow(
        'asset job failed (missing)',
      );
      expect((await rowOf(c, id)).status).toBe('rejected');
      expect(await filesOf(c, missing)).toEqual([null, null, null]);
      expect(await usedBytes(c)).toBe(before);
    });
  },
);

describe('another workspace’s asset', { timeout: 60_000 }, () => {
  it('is out of reach of a job of A’s that names it: its row and its file stay as they were', async () => {
    const theirs = await upload(b, picture(31));
    const before = { row: await rowOf(b, theirs.id), files: await filesOf(b, theirs) };

    await jobFor(a, theirs);
    await jobFor(a, theirs, { lastAttempt: true });
    expect(await rowOf(b, theirs.id)).toEqual(before.row);
    expect(await filesOf(b, theirs)).toEqual(before.files);
    expect(before.row.status).toBe('waiting');
  });
});

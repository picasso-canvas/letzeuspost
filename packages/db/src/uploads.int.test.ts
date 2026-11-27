// An upload round's rows against real Postgres (#403, §13 File storage, §06 Reading uploaded files, §02 Running out,
// and limits): each file becomes a `waiting` asset of the member's brand, with its own key and its `asset` job queued
// in the same transaction; a round past the plan's storage adds nothing; a brand of another workspace (or none) adds
// nothing either. The job queue is a recorder here (the real one is exercised by the feature's journey,
// tests/journeys/brand-assets.int.test.ts): what matters is that each job is written in the rows' own transaction.
// Runs in `pnpm check:services` and CI's `services` job; every row is this run's, and each test's assets are removed
// after it.
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { loadEnv } from '@lzp/config';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db, type Tx } from './db.ts';
import { assetProcessing } from './jobs/asset-processing.ts';
import type { Payload } from './jobs/queues.ts';
import { migrate } from './migrate.ts';
import { startUploads, type StorageUse } from './uploads.ts';

const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');
const { DATABASE_URL: appUrl } = loadEnv('worker');

const run = randomUUID();
const owner = new pg.Client({ connectionString: ownerUrl });
let db: Db;

interface Space {
  id: string;
  memberId: string;
  brandId: string;
}
const ws: { a: Space; b: Space } = {
  a: { id: '', memberId: '', brandId: '' },
  b: { id: '', memberId: '', brandId: '' },
};
const ctx = (space: Space) => ({ workspaceId: space.id });

beforeAll(async () => {
  await migrate(ownerUrl);
  await owner.connect();
  const space = async (label: string, plan: string | null): Promise<Space> => {
    const one = async (query: string, values: unknown[]) =>
      String((await owner.query<{ id: string }>(query, values)).rows[0]?.id);
    const id = await one(
      'insert into workspace (name, slug, plan) values ($1, $2, $3) returning id',
      [`Uploads ${label} ${run}`, `uploads-${label}-${run}`, plan],
    );
    const memberId = await one('insert into "user" (name, email) values ($1, $2) returning id', [
      `Uploads member ${label} ${run}`,
      `uploads-${label}-${run}@uploads.invalid`,
    ]);
    await owner.query(
      "insert into member (workspace_id, user_id, role) values ($1, $2, 'editor')",
      [id, memberId],
    );
    const brandId = await one(
      'insert into brand (workspace_id, name_en) values ($1, $2) returning id',
      [id, `Uploads brand ${label} ${run}`],
    );
    return { id, memberId, brandId };
  };
  ws.a = await space('a', 'agency');
  ws.b = await space('b', null);
  db = createDb(appUrl);
}, 60_000);

// Every test starts with no assets in either workspace: a test that fails part-way leaves nothing for the next one.
afterEach(async () => {
  await owner.query('delete from asset where workspace_id = any($1)', [[ws.a.id, ws.b.id]]);
});

afterAll(async () => {
  await db.close();
  await owner.query('delete from workspace where id = any($1)', [[ws.a.id, ws.b.id]]);
  await owner.query('delete from "user" where email like $1', [`%-${run}@uploads.invalid`]);
  await owner.end();
});

/** A queue that records what it was sent, and in which transaction. */
function recorder(fail = false) {
  const sent: { payload: Payload<'asset'>; tx: Tx }[] = [];
  return {
    sent,
    send: (payload: Payload<'asset'>, options: { tx: Tx }) => {
      if (fail) return Promise.reject(new Error('the queue is down'));
      sent.push({ payload, tx: options.tx });
      return Promise.resolve(randomUUID());
    },
  };
}

const allow = () => ({ ok: true }) as const;

/**
 * The rows the owner role (which row-level security doesn't bind) finds for a brand, in `id` order: a round's rows share
 * their transaction's `created_at`, and `randomUUIDv7()` isn't monotonic within a millisecond, so no other order is
 * the files' own.
 */
async function rowsOf(space: Space, brandId = space.brandId) {
  const { rows } = await owner.query<Record<string, unknown>>(
    `select id, workspace_id, brand_id, kind, storage_key, status, source, uploaded_by, size_bytes::int as size
       from asset where workspace_id = $1 and brand_id = $2 order by id`,
    [space.id, brandId],
  );
  return rows;
}

describe('startUploads(db, send, ctx, round, quota)', () => {
  it('adds a waiting row per file, with its own key and declared size, and queues its job in the same transaction', async () => {
    const queue = recorder();
    const started = await startUploads(
      db,
      queue.send,
      ctx(ws.a),
      {
        brandId: ws.a.brandId,
        uploadedBy: ws.a.memberId,
        files: [
          { kind: 'photo', sizeBytes: 1000 },
          { kind: 'document', sizeBytes: 2000 },
        ],
      },
      allow,
    );
    if (!('started' in started)) throw new Error(`refused: ${JSON.stringify(started)}`);
    expect(started.started).toHaveLength(2);
    // Each started upload is its file's (the route signs each link for that file): the same index in the round.
    const expected = started.started
      .map(({ assetId }, at) => ({
        id: assetId,
        workspace_id: ws.a.id,
        brand_id: ws.a.brandId,
        kind: at === 0 ? 'photo' : 'document',
        storage_key: `ws/${ws.a.id}/brands/${ws.a.brandId}/assets/${assetId}/original`,
        status: 'waiting',
        source: 'own',
        uploaded_by: ws.a.memberId,
        size: at === 0 ? 1000 : 2000,
      }))
      .sort((one, other) => (one.id < other.id ? -1 : 1));
    expect(await rowsOf(ws.a)).toEqual(expected);
    expect(queue.sent.map(({ payload }) => payload)).toEqual(
      started.started.map(({ assetId }) => ({
        workspaceId: ws.a.id,
        brandId: ws.a.brandId,
        assetId,
      })),
    );
    expect(queue.sent.every(({ tx }) => typeof tx.execute === 'function')).toBe(true);
  });

  it('adds no row when a job can’t be queued: the rows and their jobs go together', async () => {
    const result = startUploads(
      db,
      recorder(true).send,
      ctx(ws.a),
      {
        brandId: ws.a.brandId,
        uploadedBy: ws.a.memberId,
        files: [{ kind: 'photo', sizeBytes: 10 }],
      },
      allow,
    );
    await expect(result).rejects.toThrow('the queue is down');
    expect(await rowsOf(ws.a)).toEqual([]);
  });

  it('gives the quota the plan and what the workspace already stores, and adds nothing when it refuses', async () => {
    await owner.query(
      `insert into asset (id, workspace_id, brand_id, kind, storage_key, source, size_bytes)
       select g, $1::uuid, $2::uuid, 'photo',
              'ws/' || $1::text || '/brands/' || $2::text || '/assets/' || g::text || '/original', 'own', 500
         from (select uuidv7() as g from generate_series(1, 2)) ids`,
      [ws.a.id, ws.a.brandId],
    );
    const asked: StorageUse[] = [];
    const queue = recorder();
    const refused = await startUploads(
      db,
      queue.send,
      ctx(ws.a),
      {
        brandId: ws.a.brandId,
        uploadedBy: ws.a.memberId,
        files: [
          { kind: 'photo', sizeBytes: 30 },
          { kind: 'photo', sizeBytes: 70 },
        ],
      },
      (use) => {
        asked.push(use);
        return { ok: false, message: 'The Scale plan has 200 GB.' };
      },
    );
    expect(asked).toEqual([{ plan: 'agency', usedBytes: 1000, addingBytes: 100 }]);
    expect(refused).toEqual({ refused: 'storage', message: 'The Scale plan has 200 GB.' });
    expect(queue.sent).toEqual([]);
    expect(await rowsOf(ws.a)).toHaveLength(2);
  });

  /** One round of `files` sizes in workspace a; what the quota was asked, and the started uploads. */
  async function roundOf(...sizes: number[]) {
    const asked: StorageUse[] = [];
    const result = await startUploads(
      db,
      recorder().send,
      ctx(ws.a),
      {
        brandId: ws.a.brandId,
        uploadedBy: ws.a.memberId,
        files: sizes.map((sizeBytes) => ({ kind: 'photo' as const, sizeBytes })),
      },
      (use) => {
        asked.push(use);
        return { ok: true };
      },
    );
    if (!('started' in result)) throw new Error(`refused: ${JSON.stringify(result)}`);
    return { asked, started: result.started };
  }

  /** What the asset job does to a row it rejects (packages/db's `reject`, in the row's workspace). */
  const rejectAsJob = (assetId: string, reason: string) =>
    assetProcessing(db.forWorkspace(ctx(ws.a))).reject(assetId, reason);

  it('counts a waiting file until the job rejects it as never arrived, then no longer (Cerberus F1, F2)', async () => {
    const first = await roundOf(700);
    const [declared] = first.started;
    if (declared === undefined) throw new Error('no upload started');
    // Still waiting, inside the job's retry window: its declared size counts.
    expect((await roundOf(1)).asked).toEqual([{ plan: 'agency', usedBytes: 700, addingBytes: 1 }]);
    // The job's last try finds no original and rejects the row (apps/worker's asset job, NEVER_ARRIVED).
    expect(
      await rejectAsJob(declared.assetId, 'The file never arrived. Please upload it again.'),
    ).toBe(true);
    // The next round counts only the file still waiting (1 byte), not the one that never arrived.
    expect((await roundOf(2)).asked).toEqual([{ plan: 'agency', usedBytes: 1, addingBytes: 2 }]);
  });

  it('stops counting a file that arrived and was rejected for another reason too', async () => {
    const first = await roundOf(400, 300);
    const [badType] = first.started;
    if (badType === undefined) throw new Error('no upload started');
    expect(
      await rejectAsJob(badType.assetId, "That file isn't a PDF or a JPG, PNG, WebP or SVG image."),
    ).toBe(true);
    // The rejected file (400) no longer counts; the one still waiting (300) does.
    expect((await roundOf(5)).asked).toEqual([{ plan: 'agency', usedBytes: 300, addingBytes: 5 }]);
  });

  it('gives a workspace without a plan null, and counts only its own storage', async () => {
    const asked: StorageUse[] = [];
    await startUploads(
      db,
      recorder().send,
      ctx(ws.b),
      { brandId: ws.b.brandId, uploadedBy: ws.b.memberId, files: [{ kind: 'logo', sizeBytes: 5 }] },
      (use) => {
        asked.push(use);
        return { ok: true };
      },
    );
    expect(asked).toEqual([{ plan: null, usedBytes: 0, addingBytes: 5 }]);
  });

  it('refuses another workspace’s brand, or none, and adds nothing anywhere', async () => {
    for (const brandId of [ws.b.brandId, randomUUIDv7()]) {
      const queue = recorder();
      const result = await startUploads(
        db,
        queue.send,
        ctx(ws.a),
        { brandId, uploadedBy: ws.a.memberId, files: [{ kind: 'photo', sizeBytes: 10 }] },
        allow,
      );
      expect(result, brandId).toEqual({ refused: 'no-brand' });
      expect(queue.sent).toEqual([]);
    }
    expect(await rowsOf(ws.a, ws.b.brandId)).toEqual([]);
    expect(await rowsOf(ws.b)).toEqual([]);
  });

  it('takes two rounds at once in turn, so both can’t pass the storage limit', async () => {
    // Each round fits alone; together they don't. The workspace row's lock makes the second see the first's rows.
    const limit = 100;
    const quota = (use: StorageUse) =>
      use.usedBytes + use.addingBytes <= limit
        ? ({ ok: true } as const)
        : ({ ok: false, message: 'full' } as const);
    const round = () =>
      startUploads(
        db,
        recorder().send,
        ctx(ws.a),
        {
          brandId: ws.a.brandId,
          uploadedBy: ws.a.memberId,
          files: [{ kind: 'photo', sizeBytes: 60 }],
        },
        quota,
      );
    const results = await Promise.all([round(), round()]);
    expect(results.filter((result) => 'started' in result)).toHaveLength(1);
    expect(results.filter((result) => 'refused' in result)).toEqual([
      { refused: 'storage', message: 'full' },
    ]);
  });

  it('refuses a round that is no round: no files, or a size that is no size', async () => {
    for (const files of [
      [],
      [{ kind: 'photo' as const, sizeBytes: -1 }],
      [{ kind: 'photo' as const, sizeBytes: 1.5 }],
    ]) {
      await expect(
        startUploads(
          db,
          recorder().send,
          ctx(ws.a),
          { brandId: ws.a.brandId, uploadedBy: ws.a.memberId, files },
          allow,
        ),
      ).rejects.toThrow('startUploads');
    }
    expect(await rowsOf(ws.a)).toEqual([]);
  });
});

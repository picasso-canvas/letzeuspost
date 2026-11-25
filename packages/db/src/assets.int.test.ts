// The asset table against real Postgres (#400, §13 Data model, Files and Keeping workspaces apart): a new asset starts
// waiting; its key is its own original, in its own workspace and brand; its uploader is a member of that workspace;
// the app role changes what processing and the library change and nothing that would move the asset; and nothing of
// one workspace's library is reachable from another's. Runs in `pnpm check:services` and CI's `services` job; every
// row is this run's and is removed after it, as in brand-kits.int.test.ts.
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { loadEnv } from '@lzp/config';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from './db.ts';
import { migrate } from './migrate.ts';
import { asset } from './schema.ts';

const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');
const { DATABASE_URL: appUrl } = loadEnv('worker');

/** The SQLSTATE under whatever wraps the driver's error (Drizzle puts it in `cause`). */
function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  while (typeof current === 'object' && current !== null) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string') return code;
    current = cause;
  }
  return undefined;
}

/** The SQLSTATE the promise was refused with; fails the test if it wasn't refused by Postgres. */
async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const code = sqlState(error);
    if (code === undefined) throw error;
    return code;
  }
  throw new Error('expected Postgres to refuse this, and it did not');
}

/** "permission denied for table …" (or column), or a row the policy won't let in. */
const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';

const run = randomUUID();
const owner = new pg.Client({ connectionString: ownerUrl });
let db: Db;

interface Space {
  id: string;
  /** A member (an editor) of this workspace alone. */
  memberId: string;
  brandId: string;
}
const ws: { a: Space; b: Space } = {
  a: { id: '', memberId: '', brandId: '' },
  b: { id: '', memberId: '', brandId: '' },
};
const ctx = (space: Space) => ({ workspaceId: space.id });

/** The key §13 gives an asset's original (as @lzp/storage's `assetKey` makes it). */
const keyOf = (space: Space, brandId: string, id: string) =>
  `ws/${space.id}/brands/${brandId}/assets/${id}/original`;

beforeAll(async () => {
  await migrate(ownerUrl);
  await owner.connect();
  const space = async (label: string): Promise<Space> => {
    const one = async (query: string, values: unknown[]) =>
      String((await owner.query<{ id: string }>(query, values)).rows[0]?.id);
    const id = await one('insert into workspace (name, slug) values ($1, $2) returning id', [
      `Assets ${label} ${run}`,
      `assets-${label}-${run}`,
    ]);
    const memberId = await one('insert into "user" (name, email) values ($1, $2) returning id', [
      `Assets member ${label} ${run}`,
      `assets-${label}-${run}@assets.invalid`,
    ]);
    await owner.query(
      "insert into member (workspace_id, user_id, role) values ($1, $2, 'editor')",
      [id, memberId],
    );
    const brandId = await one(
      'insert into brand (workspace_id, name_en) values ($1, $2) returning id',
      [id, `Assets brand ${label} ${run}`],
    );
    return { id, memberId, brandId };
  };
  ws.a = await space('a');
  ws.b = await space('b');
  db = createDb(appUrl);
}, 60_000);

afterAll(async () => {
  await db.close();
  // Deleting the workspaces removes their members, brands and assets; the people go after.
  await owner.query('delete from workspace where id = any($1)', [[ws.a.id, ws.b.id]]);
  await owner.query('delete from "user" where email like $1', [`%-${run}@assets.invalid`]);
  await owner.end();
});

type NewAsset = typeof asset.$inferInsert;

/** A photo of `space`'s brand, uploaded by its member, as the upload route adds it: waiting, with its own key. */
function photoOf(space: Space, change: Partial<NewAsset> = {}): NewAsset {
  const id = randomUUIDv7();
  return {
    id,
    workspaceId: space.id,
    brandId: space.brandId,
    kind: 'photo',
    storageKey: keyOf(space, space.brandId, id),
    source: 'own',
    uploadedBy: space.memberId,
    ...change,
  };
}

/** Adds an asset as the app role, in `space`'s unit of work. */
const add = (space: Space, row: NewAsset) =>
  db.forWorkspace(ctx(space)).transaction((tx) => tx.insert(asset).values(row).returning());

/** What the owner role (which row-level security doesn't bind) finds for an asset. */
async function stored(id: string) {
  const { rows } = await owner.query<Record<string, unknown>>(
    'select workspace_id, brand_id, storage_key, status, description, uploaded_by from asset where id = $1',
    [id],
  );
  return rows;
}

describe('adding an asset', () => {
  it('starts it waiting, with no consent, no tags and nothing processing fills in', async () => {
    const [row] = await add(ws.a, photoOf(ws.a));
    expect(row).toMatchObject({
      workspaceId: ws.a.id,
      brandId: ws.a.brandId,
      status: 'waiting',
      consent: false,
      tags: [],
      peoplePresent: null,
      sha256: null,
      perceptualHash: null,
      sizeBytes: null,
      focusX: null,
      focusY: null,
    });
  });

  it('takes every kind, `example` included, and refuses any other kind, source or status', async () => {
    for (const kind of ['logo', 'photo', 'product', 'people', 'document', 'example'] as const) {
      const [row] = await add(ws.a, photoOf(ws.a, { kind }));
      expect(row?.kind).toBe(kind);
    }
    for (const change of [
      { kind: 'video' },
      { kind: 'meme' },
      { source: 'stock' },
      { status: 'approved' },
    ] as Partial<NewAsset>[]) {
      expect(await refusal(add(ws.a, photoOf(ws.a, change))), JSON.stringify(change)).toBe(
        CHECK_VIOLATION,
      );
    }
  });

  it('refuses a key that isn’t the asset’s own original in its own workspace and brand', async () => {
    const id = randomUUIDv7();
    const other = randomUUIDv7();
    for (const storageKey of [
      keyOf(ws.a, ws.a.brandId, other),
      keyOf(ws.b, ws.a.brandId, id),
      `ws/${ws.a.id}/brands/${ws.a.brandId}/assets/${id}/1600`,
      `ws/${ws.a.id}/renders/${'ab'.repeat(16)}.png`,
      `ws/${ws.a.id}/brands/${ws.a.brandId}/assets/${id}/original/../../${other}/original`,
    ]) {
      expect(await refusal(add(ws.a, photoOf(ws.a, { id, storageKey }))), storageKey).toBe(
        CHECK_VIOLATION,
      );
    }
  });

  it('refuses another workspace’s brand, even with a key that matches it', async () => {
    const id = randomUUIDv7();
    const row = photoOf(ws.a, {
      id,
      brandId: ws.b.brandId,
      storageKey: keyOf(ws.a, ws.b.brandId, id),
    });
    expect(await refusal(add(ws.a, row))).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('refuses an uploader who isn’t a member of the asset’s workspace', async () => {
    expect(await refusal(add(ws.a, photoOf(ws.a, { uploadedBy: ws.b.memberId })))).toBe(
      FOREIGN_KEY_VIOLATION,
    );
  });

  it('refuses a row of another workspace from this one’s unit of work', async () => {
    expect(await refusal(add(ws.a, photoOf(ws.b)))).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('checks the hashes’ shapes, the size and the focus point', async () => {
    for (const change of [
      { sha256: 'AB'.repeat(32) },
      { sha256: 'ab'.repeat(31) },
      { perceptualHash: 'ab'.repeat(4) },
      { perceptualHash: 'zz'.repeat(8) },
      { sizeBytes: -1 },
      { focusX: 0.5 },
      { focusX: 1.5, focusY: 0.5 },
      { focusX: 0.5, focusY: -0.1 },
    ] as Partial<NewAsset>[]) {
      expect(await refusal(add(ws.a, photoOf(ws.a, change))), JSON.stringify(change)).toBe(
        CHECK_VIOLATION,
      );
    }
    const [row] = await add(
      ws.a,
      photoOf(ws.a, {
        sha256: 'ab'.repeat(32),
        perceptualHash: 'cd'.repeat(8),
        sizeBytes: 0,
        focusX: 0,
        focusY: 1,
      }),
    );
    expect(row).toMatchObject({ sizeBytes: 0, focusX: 0, focusY: 1 });
  });
});

describe('changing an asset', () => {
  it('lets the app role fill in what processing and the library change', async () => {
    const [made] = await add(ws.a, photoOf(ws.a));
    const id = String(made?.id);
    const [row] = await db.forWorkspace(ctx(ws.a)).transaction((tx) =>
      tx
        .update(asset)
        .set({
          kind: 'people',
          sha256: 'ef'.repeat(32),
          perceptualHash: '01'.repeat(8),
          sizeBytes: 48_213,
          description: 'দুজন বাবুর্চি, গরম তন্দুরের সামনে',
          tags: ['kitchen', 'রান্নাঘর'],
          peoplePresent: true,
          consent: true,
          licence: 'own',
          credit: 'Photo: Golpo Café',
          status: 'ready',
          focusX: 0.4,
          focusY: 0.3,
          updatedAt: new Date(),
        })
        .where(eq(asset.id, id))
        .returning(),
    );
    expect(row).toMatchObject({ status: 'ready', consent: true, tags: ['kitchen', 'রান্নাঘর'] });
  });

  it('never lets it move an asset to another workspace, brand, file, source or uploader', async () => {
    const [made] = await add(ws.a, photoOf(ws.a));
    const id = String(made?.id);
    const before = await stored(id);
    for (const change of [
      { id: randomUUIDv7() },
      { workspaceId: ws.b.id },
      { brandId: ws.b.brandId },
      { storageKey: keyOf(ws.b, ws.b.brandId, id) },
      { source: 'client' },
      { uploadedBy: null },
      { createdAt: new Date(0) },
    ] as Partial<NewAsset>[]) {
      expect(
        await refusal(
          db
            .forWorkspace(ctx(ws.a))
            .transaction((tx) => tx.update(asset).set(change).where(eq(asset.id, id))),
        ),
        JSON.stringify(change),
      ).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect(await stored(id)).toEqual(before);
  });
});

describe('another workspace', () => {
  it('can’t read, change or delete an asset of this one', async () => {
    const [made] = await add(ws.a, photoOf(ws.a, { description: `A's photo ${run}` }));
    const id = String(made?.id);
    const fromB = await db.forWorkspace(ctx(ws.b)).transaction(async (tx) => ({
      read: await tx.select({ id: asset.id }).from(asset).where(eq(asset.id, id)),
      changed: await tx
        .update(asset)
        .set({ description: 'planted', status: 'rejected' })
        .where(eq(asset.id, id))
        .returning({ id: asset.id }),
      removed: await tx.delete(asset).where(eq(asset.id, id)).returning({ id: asset.id }),
    }));
    expect(fromB).toEqual({ read: [], changed: [], removed: [] });
    expect(await stored(id)).toEqual([
      expect.objectContaining({
        workspace_id: ws.a.id,
        status: 'waiting',
        description: `A's photo ${run}`,
      }),
    ]);
  });
});

describe('when its uploader or its brand goes', () => {
  it('keeps the asset in its workspace when the uploader leaves, and forgets only who uploaded it', async () => {
    const leaver = String(
      (
        await owner.query<{ id: string }>(
          'insert into "user" (name, email) values ($1, $2) returning id',
          [`Assets leaver ${run}`, `assets-leaver-${run}@assets.invalid`],
        )
      ).rows[0]?.id,
    );
    await owner.query(
      "insert into member (workspace_id, user_id, role) values ($1, $2, 'editor')",
      [ws.a.id, leaver],
    );
    const [made] = await add(ws.a, photoOf(ws.a, { uploadedBy: leaver }));
    const id = String(made?.id);
    await owner.query('delete from member where workspace_id = $1 and user_id = $2', [
      ws.a.id,
      leaver,
    ]);
    expect(await stored(id)).toEqual([
      expect.objectContaining({ workspace_id: ws.a.id, brand_id: ws.a.brandId, uploaded_by: null }),
    ]);
  });

  it('deletes a brand’s assets with the brand (§13 Deleting)', async () => {
    const brandId = String(
      (
        await owner.query<{ id: string }>(
          'insert into brand (workspace_id, name_en) values ($1, $2) returning id',
          [ws.a.id, `Assets brand gone ${run}`],
        )
      ).rows[0]?.id,
    );
    const id = randomUUIDv7();
    await add(ws.a, photoOf(ws.a, { id, brandId, storageKey: keyOf(ws.a, brandId, id) }));
    expect(await stored(id)).toHaveLength(1);
    await owner.query('delete from brand where id = $1', [brandId]);
    expect(await stored(id)).toEqual([]);
  });
});

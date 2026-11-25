// The Brand kit feature's journey (§19 Features, #136): a member saves a kit, a new version appears, and another
// workspace's member can't read it. It is the feature's first task (#398), and the tables (T2) and the editor that save
// a kit don't exist yet, so it is marked as an expected failure (`it.fails`, Vitest's `test.fail()`): CI stays green
// while it fails, and goes red the day it passes with the mark still on. The feature's last task takes the mark off.
//
// What it calls that doesn't exist yet is the save and read API of `@lzp/db` for the `brand_kit_version` table (§13:
// an immutable JSON snapshot per save, checked by `BrandKitSchema`). It is loaded at the point of use, so the test fails
// there with a clear message and not at import. T2 may change a call to follow its real API (and make a brand first,
// if its table needs one), but never weaken an assertion.
//
// Runs only in `pnpm check:services` and CI's `services` job (the `.int.test.ts` name; Postgres comes from
// docker/compose.yml). Every workspace, person and row here is this run's (`run`), as in data.int.test.ts.
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.ts';
import { BrandKitSchema, type BrandKit } from '../../packages/core/src/index.ts';
import {
  createDb,
  member,
  migrate,
  workspace,
  type Db,
  type WorkspaceCtx,
} from '../../packages/db/src/index.ts';

/** A result row: the columns by name. */
type Row = Record<string, string | boolean | undefined>;

/** A query as text: each `${value}` becomes a quoted SQL literal (every value is one this test made). */
function text(strings: TemplateStringsArray, ...values: string[]): string {
  let query = '';
  strings.forEach((part, i) => {
    query += part;
    const value = values[i];
    if (value !== undefined) query += `'${value.replaceAll("'", "''")}'`;
  });
  return query;
}

/** The save and read API T2 adds to `@lzp/db` (named here as the journey expects it). */
interface BrandKitApi {
  /** Saves the kit as a new, immutable version of the brand's kit; returns its number (1, 2, ...). */
  saveBrandKit: (
    db: Db,
    ctx: WorkspaceCtx,
    input: { brandId: string; kit: BrandKit; savedBy: string },
  ) => Promise<{ version: number }>;
  /** The brand's kit versions as the workspace's context sees them, oldest first. */
  listBrandKitVersions: (
    db: Db,
    ctx: WorkspaceCtx,
    brandId: string,
  ) => Promise<{ version: number; kit: BrandKit }[]>;
}

async function loadBrandKitApi(): Promise<BrandKitApi> {
  const exports = (await import('../../packages/db/src/index.ts')) as Record<string, unknown>;
  if (
    typeof exports['saveBrandKit'] !== 'function' ||
    typeof exports['listBrandKitVersions'] !== 'function'
  ) {
    throw new Error(
      '@lzp/db has no saveBrandKit and listBrandKitVersions yet: T2 (the tables) adds them',
    );
  }
  return exports as unknown as BrandKitApi;
}

/** A workspace and one member (an editor), made by the owner role as data.int.test.ts makes its Owners. */
async function seedWorkspace(
  owner: Db,
  label: string,
  run: string,
): Promise<{ workspaceId: string; userId: string }> {
  const workspaceId = randomUUIDv7();
  const userId = await owner.forWorkspace({ workspaceId }).transaction(async (tx) => {
    const { rows } = await tx.execute<Row>(
      text`insert into "user" (name, email) values (${`Member ${label} ${run}`}, ${`member-${label}-${run}@journey.invalid`}) returning id`,
    );
    const id = String(rows[0]?.id);
    await tx.insert(workspace).values({
      id: workspaceId,
      name: `Kit journey ${label} ${run}`,
      slug: `kit-journey-${label}-${run}`,
    });
    await tx.insert(member).values({ workspaceId, userId: id, role: 'editor' });
    return id;
  });
  return { workspaceId, userId };
}

const at = '2026-11-25T09:00:00.000Z';

/** A small kit as the editor saves it: a Bangladeshi café, its name typed, its colour read from the website. */
function kitOf(name: string): BrandKit {
  return BrandKitSchema.parse({
    identity: {
      name: { value: name, source: 'typed', ref: null, at, confidence: 'found' },
      nameBn: { value: 'গল্প ক্যাফে', source: 'typed', ref: null, at, confidence: 'found' },
      colors: {
        primary: {
          value: '#8b2e16',
          source: 'website',
          ref: 'https://golpo.example/',
          at,
          confidence: 'found',
        },
      },
    },
    voice: {},
    facts: {},
    look: {},
    rules: {},
    publishing: {},
    holidays: {},
  });
}

describe('the Brand kit feature: a saved kit is versioned and stays in its workspace', () => {
  it.fails(
    'saves a kit, shows a new version, and hides it from another workspace',
    { timeout: 60_000 },
    async () => {
      const env = loadEnv('migrate');
      const run = randomUUID();
      const cleanups: (() => Promise<void>)[] = [];
      try {
        await migrate(env.DATABASE_OWNER_URL);
        const db = createDb(loadEnv('worker').DATABASE_URL);
        cleanups.push(() => db.close());
        const ownerDb = createDb(env.DATABASE_OWNER_URL);
        cleanups.push(() => ownerDb.close());

        // Two workspaces, each with a member.
        const a = await seedWorkspace(ownerDb, 'a', run);
        const b = await seedWorkspace(ownerDb, 'b', run);
        const ctxA = { workspaceId: a.workspaceId };
        const ctxB = { workspaceId: b.workspaceId };
        cleanups.push(async () => {
          const clean = (ctx: WorkspaceCtx, query: string) =>
            ownerDb.forWorkspace(ctx).transaction((tx) => tx.execute(query));
          await clean(ctxA, text`delete from workspace where id = ${a.workspaceId}`);
          await clean(ctxB, text`delete from workspace where id = ${b.workspaceId}`);
          await clean(ctxA, text`delete from "user" where id in (${a.userId}, ${b.userId})`);
        });

        const { saveBrandKit, listBrandKitVersions } = await loadBrandKitApi();
        const brandId = randomUUIDv7();

        // A's member saves a kit, then changes it and saves again: two versions, in order.
        const first = kitOf('Golpo Café');
        const second = kitOf('Golpo Café Dhanmondi');
        expect(await saveBrandKit(db, ctxA, { brandId, kit: first, savedBy: a.userId })).toEqual({
          version: 1,
        });
        expect(await saveBrandKit(db, ctxA, { brandId, kit: second, savedBy: a.userId })).toEqual({
          version: 2,
        });
        const versions = await listBrandKitVersions(db, ctxA, brandId);
        expect(versions.map((row) => row.version)).toEqual([1, 2]);
        // Each version is the kit as it was saved, and the first one was not rewritten by the second save.
        expect(versions[0]?.kit).toEqual(first);
        expect(versions[1]?.kit).toEqual(second);

        // B's member can't read A's versions, and can't add one to A's brand.
        expect(await listBrandKitVersions(db, ctxB, brandId)).toEqual([]);
        await expect(
          saveBrandKit(db, ctxB, { brandId, kit: kitOf('Planted'), savedBy: b.userId }),
        ).rejects.toThrow();
        expect((await listBrandKitVersions(db, ctxA, brandId)).map((row) => row.version)).toEqual([
          1, 2,
        ]);
      } finally {
        for (const cleanup of cleanups.reverse()) await cleanup();
      }
    },
  );
});

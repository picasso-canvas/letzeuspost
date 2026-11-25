// The Brand kit feature's journey (§19 Features, #136): a member saves a kit, a new version appears, and another
// workspace's member can't read it. #398 started it marked as an expected failure (`it.fails`, Vitest's
// `test.fail()`), before the tables existed; #399 added the tables and the save and read API, and took the mark off.
//
// It calls `@lzp/db`'s `brandKits(db, BrandKitSchema)`: `createBrand` (under the Starter plan's brand limit, with
// @lzp/core's `canAddBrand`), then `saveKit`, which checks the kit with `BrandKitSchema` and writes an immutable version
// per Save (§13), and `kitVersions`. Who saved a version isn't recorded by the table: that is the audit log's (§13).
//
// Runs only in `pnpm check:services` and CI's `services` job (the `.int.test.ts` name; Postgres comes from
// docker/compose.yml). Every workspace, person and row here is this run's (`run`), as in data.int.test.ts.
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.ts';
import { plans } from '../../config/plans.ts';
import { BrandKitSchema, type BrandKit } from '../../packages/core/src/index.ts';
import { canAddBrand } from '../../packages/core/src/quotas/index.ts';
import {
  brandKits,
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
  it(
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
          // Deleting a workspace removes its brands, and a brand its kit versions.
          const clean = (ctx: WorkspaceCtx, query: string) =>
            ownerDb.forWorkspace(ctx).transaction((tx) => tx.execute(query));
          await clean(ctxA, text`delete from workspace where id = ${a.workspaceId}`);
          await clean(ctxB, text`delete from workspace where id = ${b.workspaceId}`);
          await clean(ctxA, text`delete from "user" where id in (${a.userId}, ${b.userId})`);
        });

        const kits = brandKits(db, BrandKitSchema);
        // A's brand, added under the Starter plan's limit.
        const { id: brandId } = await kits.createBrand(ctxA, { nameEn: 'Golpo Café' }, (n) =>
          canAddBrand(plans.starter, n),
        );

        // A's member saves a kit, then changes it and saves again: two versions, in order.
        const first = kitOf('Golpo Café');
        const second = kitOf('Golpo Café Dhanmondi');
        expect(await kits.saveKit(ctxA, brandId, first)).toEqual({
          id: expect.any(String) as unknown,
          version: 1,
        });
        expect(await kits.saveKit(ctxA, brandId, second)).toEqual({
          id: expect.any(String) as unknown,
          version: 2,
        });
        const versions = await kits.kitVersions(ctxA, brandId);
        expect(versions.map((row) => row.version)).toEqual([1, 2]);
        // Each version is the kit as it was saved, and the first one was not rewritten by the second save.
        expect(versions[0]?.kit).toEqual(first);
        expect(versions[1]?.kit).toEqual(second);

        // B's member can't read A's versions, and can't add one to A's brand.
        expect(await kits.kitVersions(ctxB, brandId)).toEqual([]);
        await expect(kits.saveKit(ctxB, brandId, kitOf('Planted'))).rejects.toThrow();
        expect((await kits.kitVersions(ctxA, brandId)).map((row) => row.version)).toEqual([1, 2]);
      } finally {
        for (const cleanup of cleanups.reverse()) await cleanup();
      }
    },
  );
});

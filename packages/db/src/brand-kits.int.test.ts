// Brands and their kit versions against real Postgres (#399, §13 Data model and Keeping workspaces apart): a new
// version on every Save, versions the app role can't change or remove, a current version that moves only with a Save,
// the brand-count limit under concurrent adds, and nothing of one workspace's brands reachable from another's. Runs in
// `pnpm check:services` and CI's `services` job; every row is this run's and is removed after it, as in rls.int.test.ts.
import { randomUUID } from 'node:crypto';
import { loadEnv, plans } from '@lzp/config';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrandKitSchema, type BrandKit } from '../../core/src/index.ts';
import { canAddBrand } from '../../core/src/quotas/index.ts';
import { brandKits, type BrandKits } from './brand-kits.ts';
import { createDb, type Db } from './db.ts';
import { migrate } from './migrate.ts';
import { brand, brandKitVersion } from './schema.ts';

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

/** "permission denied for table …", or a row the policy won't let in. */
const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';

const at = '2026-11-25T09:00:00.000Z';

/** A kit as the editor saves it: a Bangladeshi café, its names typed, its colour read from its website. */
function kitOf(nameEn: string, primary = '#8b2e16'): BrandKit {
  return BrandKitSchema.parse({
    identity: {
      name: { value: nameEn, source: 'typed', ref: null, at, confidence: 'found' },
      nameBn: { value: 'গল্প ক্যাফে', source: 'typed', ref: null, at, confidence: 'found' },
      colors: {
        primary: {
          value: primary,
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

const run = randomUUID();
const owner = new pg.Client({ connectionString: ownerUrl });
let db: Db;
let kits: BrandKits<BrandKit>;
const ws = { a: '', b: '', limit: '' };
const ctx = (workspaceId: string) => ({ workspaceId });
/** Every brand may be added: for the tests that aren't about the limit. */
const always = () => true;

beforeAll(async () => {
  await migrate(ownerUrl);
  await owner.connect();
  const space = async (label: string) => {
    const { rows } = await owner.query<{ id: string }>(
      'insert into workspace (name, slug) values ($1, $2) returning id',
      [`Brands ${label} ${run}`, `brands-${label}-${run}`],
    );
    return String(rows[0]?.id);
  };
  ws.a = await space('a');
  ws.b = await space('b');
  ws.limit = await space('limit');
  db = createDb(appUrl);
  kits = brandKits(db, BrandKitSchema);
}, 60_000);

afterAll(async () => {
  await db.close();
  // Deleting the workspaces removes their brands, and the brands their versions.
  await owner.query('delete from workspace where id = any($1)', [[ws.a, ws.b, ws.limit]]);
  await owner.end();
});

/** What the owner role (which row-level security doesn't bind) finds for a brand. */
async function stored(brandId: string) {
  const versions = await owner.query<{ version: string; kit: unknown; workspace_id: string }>(
    'select version, kit, workspace_id from brand_kit_version where brand_id = $1 order by version',
    [brandId],
  );
  const current = await owner.query<{ current_kit_version: string | null }>(
    'select current_kit_version from brand where id = $1',
    [brandId],
  );
  return {
    versions: versions.rows.map((row) => ({
      version: Number(row.version),
      kit: row.kit,
      workspaceId: row.workspace_id,
    })),
    current:
      current.rows[0]?.current_kit_version == null
        ? null
        : Number(current.rows[0].current_kit_version),
  };
}

describe('saveKit(ctx, brand, kit)', () => {
  it('writes a new version on every Save, the same kit saved twice included, and makes it current', async () => {
    const { id } = await kits.createBrand(
      ctx(ws.a),
      { nameEn: `Golpo ${run}`, nameBn: 'গল্প' },
      always,
    );
    expect(await stored(id)).toEqual({ versions: [], current: null });

    const first = kitOf('Golpo Café');
    const second = kitOf('Golpo Café Dhanmondi', '#1b1b1b');
    expect((await kits.saveKit(ctx(ws.a), id, first)).version).toBe(1);
    expect((await kits.saveKit(ctx(ws.a), id, second)).version).toBe(2);
    expect((await kits.saveKit(ctx(ws.a), id, second)).version).toBe(3);

    expect(await stored(id)).toEqual({
      versions: [
        { version: 1, kit: first, workspaceId: ws.a },
        { version: 2, kit: second, workspaceId: ws.a },
        { version: 3, kit: second, workspaceId: ws.a },
      ],
      current: 3,
    });
    const read = await kits.kitVersions(ctx(ws.a), id);
    expect(read.map((row) => [row.version, row.kit])).toEqual([
      [1, first],
      [2, second],
      [3, second],
    ]);
  });

  it('refuses a kit the schema refuses, and writes nothing', async () => {
    const { id } = await kits.createBrand(ctx(ws.a), { nameEn: `Refused ${run}` }, always);
    const wrong = { ...kitOf('Golpo'), identity: { colors: { primary: { value: 'red' } } } };
    await expect(kits.saveKit(ctx(ws.a), id, wrong)).rejects.toThrow();
    expect(await stored(id)).toEqual({ versions: [], current: null });
  });

  it('gives each of two Saves at once its own version', async () => {
    const { id } = await kits.createBrand(ctx(ws.a), { nameEn: `Together ${run}` }, always);
    const saved = await Promise.all([
      kits.saveKit(ctx(ws.a), id, kitOf('One')),
      kits.saveKit(ctx(ws.a), id, kitOf('Two')),
    ]);
    expect(saved.map((row) => row.version).sort()).toEqual([1, 2]);
    expect((await stored(id)).current).toBe(2);
  });
});

describe('brand_kit_version, for the app role', () => {
  it("can't be changed or removed, in its own workspace either", async () => {
    const { id } = await kits.createBrand(ctx(ws.a), { nameEn: `Immutable ${run}` }, always);
    const kit = kitOf('Golpo Café');
    await kits.saveKit(ctx(ws.a), id, kit);
    const asA = db.forWorkspace(ctx(ws.a));
    const attempts = [
      () =>
        asA.transaction((tx) =>
          tx
            .update(brandKitVersion)
            .set({ kit: kitOf('Rewritten') })
            .where(eq(brandKitVersion.brandId, id)),
        ),
      () =>
        asA.transaction((tx) =>
          tx.update(brandKitVersion).set({ version: 9 }).where(eq(brandKitVersion.brandId, id)),
        ),
      () =>
        asA.transaction((tx) => tx.delete(brandKitVersion).where(eq(brandKitVersion.brandId, id))),
      () => asA.transaction((tx) => tx.execute(sql`truncate brand_kit_version`)),
    ];
    for (const attempt of attempts) expect(await refusal(attempt())).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await stored(id)).toEqual({
      versions: [{ version: 1, kit, workspaceId: ws.a }],
      current: 1,
    });
  });

  it('goes with its brand when the brand is deleted', async () => {
    const { id } = await kits.createBrand(ctx(ws.a), { nameEn: `Deleted ${run}` }, always);
    await kits.saveKit(ctx(ws.a), id, kitOf('Golpo Café'));
    const removed = await db
      .forWorkspace(ctx(ws.a))
      .transaction((tx) => tx.delete(brand).where(eq(brand.id, id)).returning({ id: brand.id }));
    expect(removed).toEqual([{ id }]);
    expect((await stored(id)).versions).toEqual([]);
  });
});

describe('brand.current_kit_version', () => {
  it('moves only to the newest saved version: never back, nowhere else, never cleared', async () => {
    const { id } = await kits.createBrand(ctx(ws.a), { nameEn: `Pointer ${run}` }, always);
    await kits.saveKit(ctx(ws.a), id, kitOf('One'));
    await kits.saveKit(ctx(ws.a), id, kitOf('Two'));
    const asA = db.forWorkspace(ctx(ws.a));
    for (const value of [1, 3, null]) {
      expect(
        await refusal(
          asA.transaction((tx) =>
            tx.update(brand).set({ currentKitVersion: value }).where(eq(brand.id, id)),
          ),
        ),
        String(value),
      ).toBe(CHECK_VIOLATION);
    }
    // Other fields still change, and leave it where it is.
    await asA.transaction((tx) =>
      tx.update(brand).set({ nameBn: 'গল্প ক্যাফে' }).where(eq(brand.id, id)),
    );
    expect((await stored(id)).current).toBe(2);
  });

  it('is empty on a new brand: one made pointing at a version is refused', async () => {
    expect(
      await refusal(
        db
          .forWorkspace(ctx(ws.a))
          .transaction((tx) =>
            tx
              .insert(brand)
              .values({ workspaceId: ws.a, nameEn: `Ahead ${run}`, currentKitVersion: 1 }),
          ),
      ),
    ).toBe(CHECK_VIOLATION);
  });
});

describe('createBrand(ctx, brand, allowed), with canAddBrand and the Starter plan (3 brands)', () => {
  const starter = (brandsNow: number) => canAddBrand(plans.starter, brandsNow);

  it('adds brands up to the limit, refuses the next, and lets only one of two adds at once take the last place', async () => {
    const limitCtx = ctx(ws.limit);
    await kits.createBrand(limitCtx, { nameEn: `First ${run}` }, starter);
    await kits.createBrand(limitCtx, { nameEn: `Second ${run}` }, starter);
    const both = await Promise.allSettled([
      kits.createBrand(limitCtx, { nameEn: `Third ${run}` }, starter),
      kits.createBrand(limitCtx, { nameEn: `Third too ${run}` }, starter),
    ]);
    expect(both.map((each) => each.status).sort()).toEqual(['fulfilled', 'rejected']);
    await expect(kits.createBrand(limitCtx, { nameEn: `Fourth ${run}` }, starter)).rejects.toThrow(
      'brand limit reached',
    );
    const { rows } = await owner.query<{ n: number }>(
      'select count(*)::int as n from brand where workspace_id = $1',
      [ws.limit],
    );
    expect(rows).toEqual([{ n: plans.starter.brands }]);
  });

  it("counts only the workspace's own brands", async () => {
    // B has none of its own, whatever A has.
    let seen = -1;
    await kits.createBrand(ctx(ws.b), { nameEn: `B's first ${run}` }, (brandsNow) => {
      seen = brandsNow;
      return true;
    });
    expect(seen).toBe(0);
  });
});

describe("another workspace's brands", () => {
  it("can't be read, saved to, pointed at or changed from B's unit of work", async () => {
    const { id } = await kits.createBrand(ctx(ws.a), { nameEn: `A's own ${run}` }, always);
    const kit = kitOf('Golpo Café');
    await kits.saveKit(ctx(ws.a), id, kit);
    const asB = db.forWorkspace(ctx(ws.b));

    expect(await kits.kitVersions(ctx(ws.b), id)).toEqual([]);
    await expect(kits.saveKit(ctx(ws.b), id, kitOf('Planted'))).rejects.toThrow(
      'no such brand in this workspace',
    );
    // A version of B's that names A's brand: the key wants the brand in B, and there is none.
    expect(
      await refusal(
        asB.transaction((tx) =>
          tx.insert(brandKitVersion).values({ workspaceId: ws.b, brandId: id, version: 2, kit }),
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
    // A row written into A from B's unit of work: the policy refuses it.
    expect(
      await refusal(
        asB.transaction((tx) =>
          tx.insert(brandKitVersion).values({ workspaceId: ws.a, brandId: id, version: 2, kit }),
        ),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    const touched = await asB.transaction(async (tx) => ({
      brands: await tx.select().from(brand).where(eq(brand.id, id)),
      renamed: await tx
        .update(brand)
        .set({ nameEn: 'Taken over' })
        .where(eq(brand.id, id))
        .returning({ id: brand.id }),
      removed: await tx.delete(brand).where(eq(brand.id, id)).returning({ id: brand.id }),
    }));
    expect(touched).toEqual({ brands: [], renamed: [], removed: [] });

    expect(await stored(id)).toEqual({
      versions: [{ version: 1, kit, workspaceId: ws.a }],
      current: 1,
    });
    const name = await owner.query<{ name_en: string }>('select name_en from brand where id = $1', [
      id,
    ]);
    expect(name.rows).toEqual([{ name_en: `A's own ${run}` }]);
  });
});

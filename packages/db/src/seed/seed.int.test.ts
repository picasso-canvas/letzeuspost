// The seeds on Postgres (#79, Q14, #411), in `pnpm check:services` and CI's `services` job, as the owner role, which is
// the only role that may set the platform-admin flag. Each run's workspace has a slug of its own, so the test never
// meets a real "Picasso Studio" or "Northwind Social" in the database it runs on, and every row it makes is removed at
// the end.
import { randomUUID } from 'node:crypto';
import { loadEnv, plans } from '@lzp/config';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrandKitSchema } from '../../../core/src/index.ts';
import { canAddBrand } from '../../../core/src/quotas/index.ts';
import { brandKits } from '../brand-kits.ts';
import { createDb, openPool } from '../db.ts';
import { migrate } from '../migrate.ts';
import { runDevSeed, runSeed } from './run.ts';
import { sampleBrands } from './sample-brands.ts';
import { devSeed, seedWorkspace, studioSeed, type Seed } from './seed.ts';

const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('seed');
const { DATABASE_URL: appUrl } = loadEnv('worker');
const run = randomUUID().slice(0, 8);
const pool = openPool(ownerUrl);
const orm = drizzle({ client: pool });

const studio: Seed = {
  ...studioSeed({ email: `zeus-${run}@seed.invalid`, name: 'Zeus' }),
  workspace: { name: 'Picasso Studio', slug: `picasso-studio-${run}` },
};
/** Northwind Social with this run's slug, `tag` in its slug, and its people's addresses. */
const northwind = (tag: string): Seed => ({
  workspace: { name: 'Northwind Social', slug: `northwind-social-${tag}${run}` },
  people: devSeed().people.map((person) => ({
    ...person,
    email: person.email.replace('@', `-${tag}${run}@`),
  })),
});
const dev = northwind('');
/** Workspaces of their own for a half-done run and for two runs at once. */
const half = northwind('half-');
const race = northwind('race-');
/** A workspace that already has brands named like the samples, and the one the seed adds to next to it. */
const other = northwind('other-');
const next = northwind('next-');
/** Workspaces at the brand limit and with room, for createBrand's count. */
const full = northwind('full-');
const room = northwind('room-');

const starter = (brandsNow: number) => canAddBrand(plans.starter, brandsNow);

/** A workspace's brands and their kit versions, as the database holds them, by name and version. */
async function brandsOf(slug: string) {
  const { rows } = await orm.execute(
    sql`select b.id, b.name_en, b.name_bn, b.current_kit_version::int as current_kit_version, b.updated_at,
               v.id as version_id, v.version::int as version, v.kit, v.created_at as saved_at
        from brand b join workspace w on w.id = b.workspace_id
        left join brand_kit_version v on v.brand_id = b.id
        where w.slug = ${slug} order by b.name_en, v.version`,
  );
  return rows;
}

/** What the sample brands' rows must be: each with its names and its kit, saved once, as version 1. */
const sampleRows = () =>
  sampleBrands()
    .map(({ nameEn, nameBn, kit }) => ({
      name_en: nameEn,
      name_bn: nameBn ?? null,
      current_kit_version: 1,
      version: 1,
      kit: BrandKitSchema.parse(kit),
    }))
    .sort((one, other) => one.name_en.localeCompare(other.name_en));

/** Everything the seed touches for one workspace: its row, its members, and its people's rows. */
async function snapshot(seed: Seed) {
  const emails = seed.people.map((person) => person.email);
  const { rows: workspaces } = await orm.execute(
    sql`select * from workspace where slug = ${seed.workspace.slug}`,
  );
  const { rows: members } = await orm.execute(
    sql`select m.*, u.email from member m join workspace w on w.id = m.workspace_id join "user" u on u.id = m.user_id
        where w.slug = ${seed.workspace.slug} order by u.email`,
  );
  const { rows: people } = await orm.execute(
    sql`select * from "user" where email in ${emails} order by email`,
  );
  return { workspaces, members, people };
}

beforeAll(async () => {
  await migrate(ownerUrl);
});

afterAll(async () => {
  // A workspace's brands and kit versions go with it.
  for (const seed of [studio, dev, half, race, other, next, full, room]) {
    await orm.execute(sql`delete from workspace where slug = ${seed.workspace.slug}`);
    await orm.execute(sql`delete from "user" where email in ${seed.people.map((p) => p.email)}`);
  }
  await pool.end();
});

describe('seed:studio', () => {
  it('creates the workspace and Zeus’s account as its only Owner, with the platform-admin flag', async () => {
    expect(await seedWorkspace(orm, studio)).toMatchObject({ changed: true });
    const { workspaces, members, people } = await snapshot(studio);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({ name: 'Picasso Studio', slug: studio.workspace.slug });
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      email: studio.people[0]?.email,
      name: 'Zeus',
      is_platform_admin: true,
    });
    expect(members.map((m) => [m['email'], m['role']])).toEqual([
      [studio.people[0]?.email, 'owner'],
    ]);
  });

  it('changes nothing on a second run', async () => {
    const before = await snapshot(studio);
    expect(await seedWorkspace(orm, studio)).toMatchObject({ changed: false });
    expect(await snapshot(studio)).toEqual(before);
  });

  it('stays brand-free: Picasso is created through the product (#411)', async () => {
    // What `seed:studio` runs (studio.ts): the workspace and its Owner, and nothing else.
    const { workspaceId } = await runSeed(ownerUrl, studio);
    const { rows } = await orm.execute(
      sql`select (select count(*)::int from brand where workspace_id = ${workspaceId}) as brands,
                 (select count(*)::int from brand_kit_version where workspace_id = ${workspaceId}) as kits`,
    );
    expect(rows).toEqual([{ brands: 0, kits: 0 }]);
  });

  it('refuses a workspace that already has another Owner, and changes nothing', async () => {
    const intruder: Seed = {
      ...studio,
      people: [
        { ...studio.people[0], email: `other-${run}@seed.invalid` } as Seed['people'][number],
      ],
    };
    const before = await snapshot(studio);
    await expect(seedWorkspace(orm, intruder)).rejects.toThrow(/Owner/);
    expect(await snapshot(studio)).toEqual(before);
    const { rows } = await orm.execute(
      sql`select 1 from "user" where email = ${`other-${run}@seed.invalid`}`,
    );
    expect(rows).toEqual([]);
  });
});

describe('seed:dev', () => {
  it('creates Northwind Social with an owner and an editor, and a second run changes nothing', async () => {
    expect(await seedWorkspace(orm, dev)).toMatchObject({ changed: true });
    const first = await snapshot(dev);
    expect(first.workspaces[0]).toMatchObject({ name: 'Northwind Social' });
    expect(first.members.map((m) => m['role']).sort()).toEqual(['editor', 'owner']);
    expect(first.people.every((p) => p['is_platform_admin'] === false)).toBe(true);
    expect(await seedWorkspace(orm, dev)).toMatchObject({ changed: false });
    expect(await snapshot(dev)).toEqual(first);
  });

  it('adds Golpo Café, Ironline Studio and Brightwell Dental, each with its full kit as version 1 (#411)', async () => {
    expect(await brandsOf(dev.workspace.slug)).toEqual([]);
    // What `seed:dev` runs (dev.ts): the workspace was there already, its brands weren't.
    expect(await runDevSeed(ownerUrl, dev)).toEqual({ changed: true });
    expect(await brandsOf(dev.workspace.slug)).toMatchObject(sampleRows());
  });

  it('changes nothing on a second run: no brand, kit version or person added or changed', async () => {
    const before = { brands: await brandsOf(dev.workspace.slug), rest: await snapshot(dev) };
    expect(await runDevSeed(ownerUrl, dev)).toEqual({ changed: false });
    expect({ brands: await brandsOf(dev.workspace.slug), rest: await snapshot(dev) }).toEqual(
      before,
    );
  });

  it('finishes a run that stopped between adding a brand and saving its kit, without a second brand', async () => {
    const { workspaceId } = await runSeed(ownerUrl, half);
    const app = createDb(ownerUrl);
    try {
      await brandKits(app, BrandKitSchema).createBrand(
        { workspaceId },
        { nameEn: 'Golpo Café', nameBn: 'গল্প ক্যাফে' },
        (brandsNow) => canAddBrand(plans.starter, brandsNow),
      );
    } finally {
      await app.close();
    }
    expect(await runDevSeed(ownerUrl, half)).toEqual({ changed: true });
    expect(await brandsOf(half.workspace.slug)).toMatchObject(sampleRows());
  });

  it('adds each brand once when two runs go at once', async () => {
    // Which run adds the workspace and which the brands is up to the locks: either may do both.
    await Promise.all([runDevSeed(ownerUrl, race), runDevSeed(ownerUrl, race)]);
    expect(await brandsOf(race.workspace.slug)).toMatchObject(sampleRows());
  });

  it("leaves another workspace's same-named brands alone: none is skipped or given a kit", async () => {
    const { workspaceId } = await runSeed(ownerUrl, other);
    const app = createDb(ownerUrl);
    try {
      const kits = brandKits(app, BrandKitSchema);
      const [golpo, ironline] = sampleBrands();
      if (golpo === undefined || ironline === undefined) throw new Error('two sample brands');
      // Golpo Café with a kit (a lookup across workspaces would skip it in `next`), Ironline Studio without one (it
      // would be given `next`'s kit).
      const withKit = await kits.createBrand(
        { workspaceId },
        { nameEn: golpo.nameEn, nameBn: golpo.nameBn },
        starter,
      );
      await kits.saveKit({ workspaceId }, withKit.id, golpo.kit);
      await kits.createBrand({ workspaceId }, { nameEn: ironline.nameEn }, starter);
    } finally {
      await app.close();
    }
    const before = await brandsOf(other.workspace.slug);
    expect(await runDevSeed(ownerUrl, next)).toEqual({ changed: true });
    expect(await brandsOf(next.workspace.slug)).toMatchObject(sampleRows());
    expect(await brandsOf(other.workspace.slug)).toEqual(before);
  });
});

describe("createBrand's brand count, for the owner role the seed runs as and for the app role (#411)", () => {
  it('counts only the workspace it adds to: an add next to a full workspace passes, and the limit holds for both roles', async () => {
    const { workspaceId: fullId } = await runSeed(ownerUrl, full);
    const { workspaceId: roomId } = await runSeed(ownerUrl, room);
    const asOwner = createDb(ownerUrl);
    const asApp = createDb(appUrl);
    try {
      const ownerKits = brandKits(asOwner, BrandKitSchema);
      const appKits = brandKits(asApp, BrandKitSchema);
      for (const nameEn of ['One', 'Two', 'Three']) {
        await ownerKits.createBrand({ workspaceId: fullId }, { nameEn }, starter);
      }
      let seen = -1;
      await ownerKits.createBrand({ workspaceId: roomId }, { nameEn: 'First' }, (brandsNow) => {
        seen = brandsNow;
        return starter(brandsNow);
      });
      expect(seen).toBe(0);
      const refused = 'brand limit reached: this workspace has 3 brands';
      await expect(
        appKits.createBrand({ workspaceId: fullId }, { nameEn: 'Fourth' }, starter),
      ).rejects.toThrow(refused);
      await expect(
        ownerKits.createBrand({ workspaceId: fullId }, { nameEn: 'Fourth too' }, starter),
      ).rejects.toThrow(refused);
    } finally {
      await asOwner.close();
      await asApp.close();
    }
    const { rows } = await orm.execute(
      sql`select w.slug, count(b.id)::int as n from workspace w left join brand b on b.workspace_id = w.id
          where w.slug in (${full.workspace.slug}, ${room.workspace.slug}) group by w.slug order by w.slug`,
    );
    expect(rows).toEqual([
      { slug: full.workspace.slug, n: 3 },
      { slug: room.workspace.slug, n: 1 },
    ]);
  });
});

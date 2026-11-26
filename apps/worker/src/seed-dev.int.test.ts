// `seed:dev` with its logos (#443) against real Postgres and a real S3 server (SeaweedFS), in `pnpm check:services` and
// CI's `services` job: each sample brand's 3 logo files go into the bucket at their originals' keys, each with a
// `waiting` row and one `asset` job written in one transaction; each kit gets a second version naming those assets,
// which still gives the renderer a kit it accepts; and a second run, a run that stopped half way, and two runs at once
// leave each logo added once. The seed marks nothing ready: another services file's worker may take these jobs, so a
// row may be processed only once its job has left `created`.
//
// It runs as `seed:dev` does (seed-dev.ts): the owner role and the file store, config/env.ts's `seed` process. Each
// run's workspaces have slugs and people of their own, so it never meets a real Northwind Social; their files, jobs,
// workspaces and people are removed at the end.
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadEnv } from '@lzp/config';
import { createDb, createJobs, JOBS_SCHEMA, migrate, type Db, type Jobs } from '@lzp/db';
import { createStorage, type Storage } from '@lzp/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrandKitSchema, toRenderKit } from '../../../packages/core/src/index.ts';
import { runDevSeed, runSeed } from '../../../packages/db/src/seed/run.ts';
import {
  sampleBrands,
  sampleLogos,
  withLogos,
  type LogoRole,
} from '../../../packages/db/src/seed/sample-brands.ts';
import { devSeed, type Seed } from '../../../packages/db/src/seed/seed.ts';
import { FONT_MANIFEST } from '../../../packages/render/src/fonts/library.ts';
import { RenderKitSchema } from '../../../packages/render/src/kit.ts';
import { addLogoAsUploaded } from './seed-logos.ts';

const env = loadEnv('seed');
const ownerUrl = env.DATABASE_OWNER_URL;
const run = randomUUID().slice(0, 8);
const storage = createStorage(env);

/** Northwind Social with this run's slug, `tag` in its slug, and its people's addresses. */
const northwind = (tag: string): Seed => ({
  workspace: { name: 'Northwind Social', slug: `northwind-social-logos-${tag}${run}` },
  people: devSeed().people.map((person) => ({
    ...person,
    email: person.email.replace('@', `-logos-${tag}${run}@`),
  })),
});
const dev = northwind('');
const half = northwind('half-');
const race = northwind('race-');
const broken = northwind('broken-');
const seeds = [dev, half, race, broken];

/** Every file a run put, so each is deleted at the end, whatever its row became. */
const put: { workspaceId: string; key: string }[] = [];
const recording: Pick<Storage, 'put'> = {
  put: async (ctx, key, bytes, contentType) => {
    put.push({ workspaceId: ctx.workspaceId, key });
    await storage.put(ctx, key, bytes, contentType);
  },
};

let db: Db;
let jobs: Jobs;
const addLogo = () => addLogoAsUploaded({ storage: recording, db, jobs });

/** A query as text, each `${value}` a quoted literal; every value is one this file made (the journey's way). */
function text(strings: TemplateStringsArray, ...values: string[]): string {
  return strings.reduce(
    (query, part, i) =>
      query + part + (values[i] === undefined ? '' : `'${values[i].replaceAll("'", "''")}'`),
    '',
  );
}

/** As the owner role, which holds every table and the job queue. */
async function asOwner<T>(statement: string): Promise<T[]> {
  const result = await db
    .forWorkspace({ workspaceId: randomUUIDv7() })
    .transaction((tx) => tx.execute(statement));
  return result.rows as T[];
}

interface LogoRow {
  id: string;
  workspace_id: string;
  brand_id: string;
  brand: string;
  kind: string;
  source: string;
  status: string;
  sha256: string | null;
  storage_key: string;
  description: string;
  uploaded_by: string;
}

/** The workspace's assets, with their brand's English name, oldest first. */
const assetsOf = (seed: Seed) =>
  asOwner<LogoRow>(
    text`select a.id, a.workspace_id, a.brand_id, b.name_en as brand, a.kind, a.source, a.status, a.sha256,
                a.storage_key, a.description, a.uploaded_by
         from asset a join brand b on b.id = a.brand_id join workspace w on w.id = a.workspace_id
         where w.slug = ${seed.workspace.slug} order by a.created_at, a.id`,
  );

/** The `asset` jobs queued for the workspace, by the id of the asset they name. */
async function jobsOf(workspaceId: string) {
  return asOwner<{ id: string; data: unknown; state: string; group_id: string | null }>(
    `select id, data, state, group_id from ${JOBS_SCHEMA}.job
     where name = 'asset' and data->>'workspaceId' = ${text`${workspaceId}`} order by data->>'assetId'`,
  );
}

/** The workspace's brands and every kit version, as the database holds them. */
const versionsOf = (seed: Seed) =>
  asOwner<{
    brand_id: string;
    name_en: string;
    current_kit_version: number;
    version: number;
    kit: unknown;
    version_id: string;
  }>(
    text`select b.id as brand_id, b.name_en, b.current_kit_version::int as current_kit_version,
                v.version::int as version, v.kit, v.id as version_id
         from brand b join workspace w on w.id = b.workspace_id join brand_kit_version v on v.brand_id = b.id
         where w.slug = ${seed.workspace.slug} order by b.name_en, v.version`,
  );

const workspaceOf = async (seed: Seed) => {
  const [row] = await asOwner<{ id: string }>(
    text`select id from workspace where slug = ${seed.workspace.slug}`,
  );
  if (row === undefined) throw new Error('no such workspace');
  return row.id;
};

const ownerOf = async (seed: Seed) => {
  const [row] = await asOwner<{ id: string }>(
    text`select id from "user" where email = ${seed.people[0]?.email ?? ''}`,
  );
  if (row === undefined) throw new Error('no Owner');
  return row.id;
};

const isKnownFont = (family: string, language: 'en' | 'bn') =>
  FONT_MANIFEST.fonts.some((font) => font.family === family && font.languages.includes(language));

/** Each sample brand's 3 logos, each once, as rows of the workspace: their ids by brand and role. */
async function logosOf(seed: Seed) {
  const rows = await assetsOf(seed);
  expect(rows).toHaveLength(9);
  const ids = new Map<string, Record<LogoRole, string>>();
  for (const sample of sampleBrands()) {
    const roles: Partial<Record<LogoRole, string>> = {};
    for (const logo of sampleLogos(sample)) {
      const matching = rows.filter(
        (row) => row.brand === sample.nameEn && row.description === logo.description,
      );
      expect(matching, `${sample.nameEn} ${logo.role}`).toHaveLength(1);
      roles[logo.role] = matching[0]?.id;
    }
    const { light, dark, mark } = roles;
    if (light === undefined || dark === undefined || mark === undefined) throw new Error('a logo');
    ids.set(sample.nameEn, { light, dark, mark });
  }
  return { rows, ids };
}

beforeAll(async () => {
  await migrate(ownerUrl);
  db = createDb(ownerUrl);
  jobs = createJobs({
    url: ownerUrl,
    db,
    // A failure of pg-boss's own fails the `send` that meets it; its messages may quote SQL, so they aren't printed.
    onError: () => undefined,
  });
  await jobs.start();
}, 60_000);

afterAll(async () => {
  for (const { workspaceId, key } of put) await storage.delete({ workspaceId }, key);
  for (const seed of seeds) {
    const [place] = await asOwner<{ id: string }>(
      text`select id from workspace where slug = ${seed.workspace.slug}`,
    );
    if (place !== undefined) {
      await asOwner(
        `delete from ${JOBS_SCHEMA}.job where name = 'asset' and data->>'workspaceId' = ${text`${place.id}`}`,
      );
    }
    // A workspace's brands, kit versions, assets and members go with it.
    await asOwner(text`delete from workspace where slug = ${seed.workspace.slug}`);
    for (const person of seed.people) {
      await asOwner(text`delete from "user" where email = ${person.email}`);
    }
  }
  await jobs.stop();
  await db.close();
  storage.close();
});

describe('seed:dev with the sample logos (#443)', () => {
  it('puts each logo in the bucket at its original key, with a waiting row and one asset job each', async () => {
    expect(await runDevSeed(ownerUrl, dev, addLogo())).toEqual({ changed: true });
    const workspaceId = await workspaceOf(dev);
    const ownerId = await ownerOf(dev);
    const { rows } = await logosOf(dev);
    const queued = await jobsOf(workspaceId);

    for (const row of rows) {
      expect(row).toMatchObject({
        workspace_id: workspaceId,
        kind: 'logo',
        source: 'own',
        uploaded_by: ownerId,
        storage_key: `ws/${workspaceId}/brands/${row.brand_id}/assets/${row.id}/original`,
      });
      const sample = sampleBrands().find((each) => each.nameEn === row.brand);
      const logo =
        sample && sampleLogos(sample).find((each) => each.description === row.description);
      if (logo === undefined) throw new Error('not a sample logo');
      const stored = await storage.get({ workspaceId }, row.storage_key, {
        maxBytes: 20 * 1024 * 1024,
      });
      expect(stored).toEqual(new Uint8Array(await readFile(logo.file)));

      const own = queued.filter((job) => (job.data as { assetId?: string }).assetId === row.id);
      expect(own).toHaveLength(1);
      expect(own[0]).toMatchObject({
        data: { workspaceId, brandId: row.brand_id, assetId: row.id },
        group_id: workspaceId,
      });
      // The seed never marks one ready: a row has moved on only when a worker has taken its job.
      if (own[0]?.state === 'created')
        expect(row).toMatchObject({ status: 'waiting', sha256: null });
    }
    expect(queued).toHaveLength(rows.length);
  });

  it('gives each kit a second version naming its logo assets, which still gives the renderer a valid kit', async () => {
    const { ids } = await logosOf(dev);
    const versions = await versionsOf(dev);
    for (const sample of sampleBrands()) {
      const own = versions.filter((row) => row.name_en === sample.nameEn);
      expect(own.map((row) => row.version)).toEqual([1, 2]);
      const [first, second] = own;
      if (first === undefined || second === undefined) throw new Error('two versions');
      expect(second.current_kit_version).toBe(2);
      const logos = ids.get(sample.nameEn);
      if (logos === undefined) throw new Error('its logos');
      const kit = BrandKitSchema.parse(second.kit);
      expect(kit).toEqual(withLogos(BrandKitSchema.parse(first.kit), logos));
      const renderKit = RenderKitSchema.parse(toRenderKit(kit, { isKnownFont }));
      expect(renderKit.logo).toEqual({ light: logos.light, dark: logos.dark });
    }
  });

  it('changes nothing on a second run: no file, row, job or kit version added', async () => {
    const workspaceId = await workspaceOf(dev);
    const files = put.length;
    // Only what the seed writes: the asset job may be processing a row, which moves its status and hashes.
    const ofRows = async () =>
      (await assetsOf(dev)).map(({ id, brand_id, storage_key, description }) => ({
        id,
        brand_id,
        storage_key,
        description,
      }));
    const before = {
      rows: await ofRows(),
      jobs: (await jobsOf(workspaceId)).map((job) => job.id),
      versions: await versionsOf(dev),
    };
    expect(await runDevSeed(ownerUrl, dev, addLogo())).toEqual({ changed: false });
    expect(put).toHaveLength(files);
    expect({
      rows: await ofRows(),
      jobs: (await jobsOf(workspaceId)).map((job) => job.id),
      versions: await versionsOf(dev),
    }).toEqual(before);
  });

  it('finishes a run that stopped after uploading a logo and before saving the version, without adding it again', async () => {
    // A run without logos (packages/db's own seed:dev), then one logo of Golpo Café added as the stopped run left it.
    expect(await runDevSeed(ownerUrl, half)).toEqual({ changed: true });
    const workspaceId = await workspaceOf(half);
    const [golpo] = sampleBrands();
    const [light] = golpo === undefined ? [] : sampleLogos(golpo);
    const [brandRow] = await asOwner<{ id: string }>(
      text`select id from brand where workspace_id = ${workspaceId} and name_en = ${golpo?.nameEn ?? ''}`,
    );
    if (light === undefined || brandRow === undefined) throw new Error('Golpo Café’s light logo');
    const earlier = await addLogo()(
      { workspaceId },
      {
        brandId: brandRow.id,
        bytes: new Uint8Array(await readFile(light.file)),
        contentType: light.contentType,
        description: light.description,
        uploadedBy: await ownerOf(half),
      },
    );

    expect(await runDevSeed(ownerUrl, half, addLogo())).toEqual({ changed: true });
    const { ids } = await logosOf(half);
    expect(ids.get('Golpo Café')?.light).toBe(earlier);
    expect(await jobsOf(workspaceId)).toHaveLength(9);
    expect((await versionsOf(half)).map((row) => row.version)).toEqual([1, 2, 1, 2, 1, 2]);
  });

  it('adds each logo once when two runs go at once', async () => {
    await Promise.all([
      runDevSeed(ownerUrl, race, addLogo()),
      runDevSeed(ownerUrl, race, addLogo()),
    ]);
    await logosOf(race);
    expect(await jobsOf(await workspaceOf(race))).toHaveLength(9);
    expect((await versionsOf(race)).map((row) => row.version)).toEqual([1, 2, 1, 2, 1, 2]);
  });

  it('adds no row when its job can’t be queued: the row and the job are one transaction', async () => {
    await runSeed(ownerUrl, broken);
    const failing = addLogoAsUploaded({
      storage: recording,
      db,
      jobs: { send: () => Promise.reject(new Error('no queue')) },
    });
    await expect(runDevSeed(ownerUrl, broken, failing)).rejects.toThrow('no queue');
    expect(await assetsOf(broken)).toEqual([]);
    expect((await versionsOf(broken)).map((row) => row.version)).toEqual([1]);
  });
});

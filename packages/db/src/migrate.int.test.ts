// The migrator runs each migration file in one transaction, so a file that fails partway leaves nothing applied (#71,
// follow-up of #164: Argus F3, Cerberus F2). CI's squawk assumes exactly that (`assume_in_transaction = true`), so this
// is the check that fails if the migrator ever stops doing it. Runs against real Postgres in `pnpm check:services` and
// CI's `services` job, as the owner role. Everything it makes sits in a schema of its own, dropped afterwards, so the
// real migrations, their record and the public tables are never touched.
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '@lzp/config';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from './migrate.ts';

const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');

/** This run's schema: drizzle records the migrations here, and the probe table goes here too. */
const schema = `migrate_probe_${randomUUID().replaceAll('-', '')}`;
const probe = `"${schema}".probe`;
const record = `"${schema}".__drizzle_migrations`;

const owner = new pg.Client({ connectionString: ownerUrl });
/** The throwaway migrations folders this run wrote, removed afterwards. */
const folders: string[] = [];

/**
 * A migrations folder with one file, as drizzle-kit writes them: a table, a row in it, then a statement that divides by
 * zero only when the first two ran (one row: 1 / (1 - 1)). Without the third statement, the file applies cleanly.
 */
function migrationsFolder(fails: boolean): string {
  const folder = mkdtempSync(join(tmpdir(), 'lzp-migrate-'));
  mkdirSync(join(folder, 'meta'));
  const statements = [
    `CREATE TABLE ${probe} ("id" integer PRIMARY KEY);`,
    `INSERT INTO ${probe} ("id") VALUES (1);`,
    ...(fails ? [`SELECT 1 / (1 - (SELECT count(*) FROM ${probe}));`] : []),
  ];
  writeFileSync(join(folder, '0000_probe.sql'), statements.join('\n--> statement-breakpoint\n'));
  const journal = {
    version: '7',
    dialect: 'postgresql',
    entries: [
      { idx: 0, version: '7', when: 1_794_298_080_915, tag: '0000_probe', breakpoints: true },
    ],
  };
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal));
  return folder;
}

/** What the database holds after a run: whether the probe table exists, its rows, and the migrations recorded. */
async function applied(): Promise<{ table: boolean; rows: number; recorded: number }> {
  const { rows } = await owner.query<{ present: boolean }>(
    'select to_regclass($1) is not null as present',
    [probe],
  );
  const table = rows[0]?.present ?? false;
  const count = async (text: string) =>
    (await owner.query<{ n: number }>(`select count(*)::int as n from ${text}`)).rows[0]?.n ?? 0;
  return { table, rows: table ? await count(probe) : 0, recorded: await count(record) };
}

beforeAll(async () => {
  await owner.connect();
});

afterAll(async () => {
  await owner.query(`drop schema if exists "${schema}" cascade`);
  await owner.end();
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

describe('migrate()', () => {
  it('leaves nothing applied when a migration fails partway', async () => {
    const folder = migrationsFolder(true);
    folders.push(folder);

    const failure: unknown = await migrate(ownerUrl, {
      migrationsFolder: folder,
      migrationsSchema: schema,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    // division_by_zero: the third statement failed, so the first two had run, in the same session, before it.
    expect(failure).toMatchObject({ cause: { code: '22012' } });

    expect(await applied()).toEqual({ table: false, rows: 0, recorded: 0 });
  });

  it('applies the same file whole once it no longer fails, which the check above would see', async () => {
    const folder = migrationsFolder(false);
    folders.push(folder);

    await migrate(ownerUrl, { migrationsFolder: folder, migrationsSchema: schema });

    expect(await applied()).toEqual({ table: true, rows: 1, recorded: 1 });
  });
});

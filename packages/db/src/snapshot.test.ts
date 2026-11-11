// drizzle-kit's snapshots (Argus F2 on #197): `pnpm --filter @lzp/db db:generate` diffs `src/schema.ts` against the
// last snapshot in ../migrations/meta, so every migration needs its snapshot and `src/schema.ts` must hold every
// table. The migrations themselves are written by hand (§13 A4); the snapshots are drizzle-kit's, so the next diff
// starts from what the database really has.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { generateDrizzleJson, generateMigration, type DrizzleSnapshotJSON } from 'drizzle-kit/api';
import { is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema.ts';

const meta = new URL('../migrations/meta/', import.meta.url);

interface Journal {
  entries: { idx: number; tag: string }[];
}

const journal = JSON.parse(readFileSync(new URL('_journal.json', meta), 'utf8')) as Journal;
const snapshotFile = (idx: number) =>
  new URL(`${String(idx).padStart(4, '0')}_snapshot.json`, meta);
const snapshot = (idx: number) =>
  JSON.parse(readFileSync(snapshotFile(idx), 'utf8')) as DrizzleSnapshotJSON;

/** The tables a module exports. */
const tablesOf = (module: Record<string, unknown>) =>
  Object.values(module).filter((value): value is PgTable => is(value, PgTable));

describe("drizzle-kit's snapshots", () => {
  it('exist for every migration in the journal, each following the one before', () => {
    let prevId = '00000000-0000-0000-0000-000000000000';
    for (const { idx, tag } of journal.entries) {
      expect(existsSync(snapshotFile(idx)), `${tag}'s snapshot`).toBe(true);
      const { id, prevId: previous } = snapshot(idx) as { id: string; prevId: string };
      expect(previous, `${tag}'s snapshot follows the one before`).toBe(prevId);
      prevId = id;
    }
  });

  it('leave drizzle-kit nothing to generate: the last one is the schema as it is', async () => {
    const last = journal.entries.at(-1);
    if (last === undefined) throw new Error('no migrations');
    const current = generateDrizzleJson(schema as Record<string, unknown>);
    expect(await generateMigration(snapshot(last.idx), current)).toEqual([]);
  });
});

describe('src/schema.ts, which db:generate reads', () => {
  it('exports every table of every file in src/schema/', async () => {
    const folder = new URL('./schema/', import.meta.url);
    const files = readdirSync(folder).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    );
    expect(files).toContain('email-message.ts');
    const exported = tablesOf(schema as Record<string, unknown>);
    for (const file of files) {
      const module = (await import(new URL(file, folder).href)) as Record<string, unknown>;
      for (const table of tablesOf(module)) expect(exported, file).toContain(table);
    }
  });
});

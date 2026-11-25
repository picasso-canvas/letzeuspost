// The brands tables as the schema and their hand-written migration declare them (#399, §13 Data model): both keep
// row-level security with §13's policy, and the app role holds no way to change or remove a kit version. The database
// itself is checked in ../brand-kits.int.test.ts (CI's services job).
import { readFileSync } from 'node:fs';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { brand, brandKitVersion } from './brands.ts';

const migration = readFileSync(
  new URL('../../migrations/0007_brands.sql', import.meta.url),
  'utf8',
);

/** Every statement of the migration that grants something to the app role. */
const grantsToApp = migration
  .split('--> statement-breakpoint')
  .map((statement) => statement.replace(/^--.*$/gm, '').trim())
  .filter((statement) => /^GRANT\b/.test(statement) && statement.includes('TO lzp_app'));

describe('the brands tables', () => {
  it.each([brand, brandKitVersion] as PgTable[])(
    'keep row-level security with §13 policy, for reads and writes',
    (table) => {
      const name = getTableName(table);
      expect(migration).toContain(`ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY;`);
      const policy = "workspace_id = current_setting('app.workspace_id')::uuid";
      expect(migration).toContain(
        `CREATE POLICY "workspace_scope" ON "${name}" AS PERMISSIVE FOR ALL TO public USING (${policy}) WITH CHECK (${policy});`,
      );
      const scope = getTableConfig(table).policies;
      expect(scope.map((p) => [p.name, p.for])).toEqual([['workspace_scope', 'all']]);
      expect(JSON.stringify(scope[0]?.using)).toContain(policy);
      expect(JSON.stringify(scope[0]?.withCheck)).toContain(policy);
      expect(getTableColumns(table).workspaceId?.notNull).toBe(true);
    },
  );

  it('give the app role only reading and adding on brand_kit_version: no UPDATE, DELETE or TRUNCATE', () => {
    const onVersions = grantsToApp.filter((grant) => grant.includes('"brand_kit_version"'));
    expect(onVersions).toEqual(['GRANT SELECT, INSERT ON "brand_kit_version" TO lzp_app;']);
  });

  it("let the app role change a brand's fields, but never its id or its workspace", () => {
    const updates = grantsToApp.filter((grant) => /\bUPDATE\b/.test(grant));
    expect(updates).toEqual([
      'GRANT UPDATE ("name_en", "name_bn", "timezone", "approval_mode", "current_kit_version", "updated_at") ON "brand" TO lzp_app;',
    ]);
  });

  it("key a version to its brand and that brand's workspace together", () => {
    const [key] = getTableConfig(brandKitVersion).foreignKeys;
    const reference = key?.reference();
    expect(reference?.columns.map((column) => column.name)).toEqual(['brand_id', 'workspace_id']);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual(['id', 'workspace_id']);
    expect(key?.onDelete).toBe('cascade');
    expect(migration).toContain(
      'FOREIGN KEY ("brand_id","workspace_id") REFERENCES "public"."brand"("id","workspace_id") ON DELETE cascade',
    );
  });

  it('guard the current kit version with a trigger on every insert and every change of it', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE TRIGGER "brand_current_kit_version_guard" BEFORE INSERT OR UPDATE OF "current_kit_version" ON "brand"',
    );
  });
});

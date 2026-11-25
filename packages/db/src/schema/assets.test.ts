// The asset table as the schema and its hand-written migration declare it (#400, §13 Data model, Files): row-level
// security with §13's policy, §13's columns, and the keys and checks that keep a row to its own brand, workspace and
// file. The database itself is checked in ../assets.int.test.ts (CI's services job).
import { readFileSync } from 'node:fs';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { asset, assetKinds, assetSources, assetStatuses } from './assets.ts';

const migration = readFileSync(
  new URL('../../migrations/0008_assets.sql', import.meta.url),
  'utf8',
);

/** Every statement of the migration, its comments taken out. */
const statements = migration
  .split('--> statement-breakpoint')
  .map((statement) => statement.replace(/^--.*$/gm, '').trim());

const grantsToApp = statements.filter(
  (statement) => /^GRANT\b/.test(statement) && statement.includes('TO lzp_app'),
);

describe('the asset table', () => {
  it('keeps row-level security with §13’s policy, for reads and writes', () => {
    expect(getTableName(asset)).toBe('asset');
    expect(migration).toContain('ALTER TABLE "asset" ENABLE ROW LEVEL SECURITY;');
    const policy = "workspace_id = current_setting('app.workspace_id')::uuid";
    expect(migration).toContain(
      `CREATE POLICY "workspace_scope" ON "asset" AS PERMISSIVE FOR ALL TO public USING (${policy}) WITH CHECK (${policy});`,
    );
    const scope = getTableConfig(asset).policies;
    expect(scope.map((p) => [p.name, p.for])).toEqual([['workspace_scope', 'all']]);
    expect(JSON.stringify(scope[0]?.using)).toContain(policy);
    expect(JSON.stringify(scope[0]?.withCheck)).toContain(policy);
  });

  it('has §13’s columns: brand, kind, storage key, hashes, size, description, tags, people, consent, licence, credit, source, status, focus, uploader', () => {
    const columns = Object.values(getTableColumns(asset)).map((column) => column.name);
    expect(columns).toEqual([
      'id',
      'workspace_id',
      'brand_id',
      'kind',
      'storage_key',
      'sha256',
      'perceptual_hash',
      'size_bytes',
      'description',
      'tags',
      'people_present',
      'consent',
      'licence',
      'credit',
      'source',
      'status',
      'focus_x',
      'focus_y',
      'uploaded_by',
      'created_at',
      'updated_at',
    ]);
    const required = Object.values(getTableColumns(asset))
      .filter((column) => column.notNull)
      .map((column) => column.name);
    expect(required.sort()).toEqual(
      [
        'id',
        'workspace_id',
        'brand_id',
        'kind',
        'storage_key',
        'tags',
        'consent',
        'source',
        'status',
        'created_at',
        'updated_at',
      ].sort(),
    );
  });

  it('starts every asset waiting, with no consent and no tags', () => {
    const columns = getTableColumns(asset);
    expect(columns.status.default).toBe('waiting');
    expect(columns.consent.default).toBe(false);
    expect(migration).toContain(`"status" text DEFAULT 'waiting' NOT NULL`);
    expect(migration).toContain(`"consent" boolean DEFAULT false NOT NULL`);
    expect(migration).toContain(`"tags" text[] DEFAULT '{}'::text[] NOT NULL`);
  });

  it('holds only the kinds, sources and statuses @lzp/core knows', () => {
    expect(assetKinds).toEqual(['logo', 'photo', 'product', 'people', 'document', 'example']);
    expect(assetSources).toEqual(['own', 'client', 'cutout']);
    expect(assetStatuses).toEqual(['ready', 'waiting', 'rejected']);
    const listed = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');
    expect(migration).toContain(`CHECK (kind in (${listed(assetKinds)}))`);
    expect(migration).toContain(`CHECK (source in (${listed(assetSources)}))`);
    expect(migration).toContain(`CHECK (status in (${listed(assetStatuses)}))`);
  });

  it('pins the storage key to the asset’s own original, under its workspace and brand (§13 File storage)', () => {
    expect(migration).toContain(
      `CHECK (storage_key = 'ws/' || workspace_id::text || '/brands/' || brand_id::text || '/assets/' || id::text || '/original')`,
    );
    expect(migration).toContain('CONSTRAINT "asset_storage_key_unique" UNIQUE("storage_key")');
  });

  it('keys an asset to its brand and that brand’s workspace together, and goes with the brand', () => {
    const keys = getTableConfig(asset).foreignKeys.map((key) => {
      const reference = key.reference();
      return {
        columns: reference.columns.map((column) => column.name),
        to: getTableName(reference.foreignTable),
        foreignColumns: reference.foreignColumns.map((column) => column.name),
        onDelete: key.onDelete,
      };
    });
    expect(keys).toContainEqual({
      columns: ['brand_id', 'workspace_id'],
      to: 'brand',
      foreignColumns: ['id', 'workspace_id'],
      onDelete: 'cascade',
    });
    expect(migration).toContain(
      'FOREIGN KEY ("brand_id","workspace_id") REFERENCES "public"."brand"("id","workspace_id") ON DELETE cascade',
    );
  });

  it('keys the uploader to a member of the same workspace, and forgets only the uploader when they leave', () => {
    const key = getTableConfig(asset)
      .foreignKeys.map((each) => each.reference())
      .find((reference) => getTableName(reference.foreignTable) === 'member');
    expect(key?.columns.map((column) => column.name)).toEqual(['workspace_id', 'uploaded_by']);
    expect(key?.foreignColumns.map((column) => column.name)).toEqual(['workspace_id', 'user_id']);
    // Only the uploader is set to null: the row keeps its workspace, which is NOT NULL.
    expect(migration).toContain(
      'FOREIGN KEY ("workspace_id","uploaded_by") REFERENCES "public"."member"("workspace_id","user_id") ON DELETE SET NULL ("uploaded_by")',
    );
  });

  it('checks the hashes’ shapes, the size and the focus point', () => {
    expect(migration).toContain(`CHECK (sha256 ~ '^[0-9a-f]{64}$')`);
    expect(migration).toContain(`CHECK (perceptual_hash ~ '^[0-9a-f]{16,64}$')`);
    expect(migration).toContain('CHECK (size_bytes >= 0)');
    expect(migration).toContain(
      'CHECK ((focus_x is null) = (focus_y is null) and focus_x between 0 and 1 and focus_y between 0 and 1)',
    );
  });

  it('lets the app role read, add and delete assets, and change what processing and the library change', () => {
    expect(grantsToApp).toEqual([
      'GRANT SELECT, INSERT, DELETE ON "asset" TO lzp_app;',
      'GRANT UPDATE ("kind", "sha256", "perceptual_hash", "size_bytes", "description", "tags", "people_present", "consent", "licence", "credit", "status", "focus_x", "focus_y", "updated_at") ON "asset" TO lzp_app;',
    ]);
  });

  it('never lets the app role move an asset to another workspace, brand, file, source or uploader', () => {
    const update = grantsToApp.find((grant) => /\bUPDATE\b/.test(grant)) ?? '';
    for (const fixed of [
      'id',
      'workspace_id',
      'brand_id',
      'storage_key',
      'source',
      'uploaded_by',
      'created_at',
    ]) {
      expect(update).not.toContain(`"${fixed}"`);
    }
  });
});

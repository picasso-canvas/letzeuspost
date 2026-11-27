// The app role's rate-limit log (#403, §13 The app's API: "Rate limits live in a Postgres table … uploads, and
// anything that starts AI work"), checked without a database. sign-in's `rate_limit_hit` is lzp_auth's alone, so the
// app role (lzp_app) can't count in it; this table is a workspace's, under §13's policy, and lzp_app's.
// ../rate-limits.int.test.ts checks the limiter, its grants and its policy against Postgres.
import { readdirSync, readFileSync } from 'node:fs';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { workspaceRateLimitHit } from './rate-limits.ts';

const folder = new URL('../../migrations/', import.meta.url);
const migrations = readdirSync(folder)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => readFileSync(new URL(file, folder), 'utf8'));
/** Every GRANT statement any migration makes on `table`. */
const grantsOn = (table: string) =>
  migrations.flatMap((text) =>
    [...text.matchAll(/GRANT[^;]*;/g)]
      .map(([statement]) => statement)
      .filter((statement) => statement.includes(`"${table}"`)),
  );

describe('the workspace_rate_limit_hit table', () => {
  const columns = getTableColumns(workspaceRateLimitHit);
  const config = getTableConfig(workspaceRateLimitHit);

  it('logs one row per allowed request in a workspace’s bucket, with its time', () => {
    expect(getTableName(workspaceRateLimitHit)).toBe('workspace_rate_limit_hit');
    expect(Object.keys(columns).sort()).toEqual(['bucket', 'createdAt', 'id', 'workspaceId']);
    expect(JSON.stringify(columns.id.default)).toContain('uuidv7()');
    expect(columns.createdAt.getSQLType()).toBe('timestamp with time zone');
    expect(columns.workspaceId.notNull).toBe(true);
    expect(columns.bucket.notNull).toBe(true);
  });

  it('belongs to its workspace, and goes with it', () => {
    const [key, ...others] = config.foreignKeys;
    expect(others).toEqual([]);
    expect(key?.reference().foreignTable).toBeDefined();
    expect(getTableName(key?.reference().foreignTable ?? workspaceRateLimitHit)).toBe('workspace');
    expect(key?.onDelete).toBe('cascade');
  });

  it('meets §13’s policy, as §13 writes it', () => {
    expect(config.policies.map((policy) => policy.name)).toEqual(['workspace_scope']);
  });

  it('lets lzp_app read, add and delete hits, never change one, and gives lzp_auth nothing', () => {
    expect(grantsOn('workspace_rate_limit_hit')).toEqual([
      'GRANT SELECT, INSERT, DELETE ON "workspace_rate_limit_hit" TO lzp_app;',
    ]);
  });
});

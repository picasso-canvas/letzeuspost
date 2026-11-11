// The two tables sign-in adds (#77), checked without a database: the account emails' outbox (Athena's decision 3,
// 2026-11-11) and the rate-limit log (§13 The app's API). Neither holds workspace data, and only lzp_auth, the auth
// handle's role, reaches them. auth-only.int.test.ts in packages/auth checks the grants against Postgres.
import { readdirSync, readFileSync } from 'node:fs';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { accountEmail, rateLimitHit } from './auth-only.ts';

const folder = new URL('../../migrations/', import.meta.url);
const migration = readdirSync(folder)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => readFileSync(new URL(file, folder), 'utf8'))
  .find((text) => text.includes('CREATE TABLE IF NOT EXISTS "account_email"'));

describe('the account_email table (the sign-in emails’ outbox)', () => {
  const columns = getTableColumns(accountEmail);

  it('holds an outbox row like email_message: template, to, status, provider id, the claiming job', () => {
    expect(getTableName(accountEmail)).toBe('account_email');
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        'userId',
        'template',
        'toAddress',
        'data',
        'status',
        'providerId',
        'failure',
        'claimedByJob',
        'sentAt',
      ]),
    );
    expect(columns.status.default).toBe('queued');
    expect(columns.userId.notNull).toBe(true);
  });

  it('carries no workspace and no row-level policy: it is a person’s, not a workspace’s', () => {
    expect(columns).not.toHaveProperty('workspaceId');
    expect(getTableConfig(accountEmail).policies).toEqual([]);
  });

  it('has a UUIDv7 id and times in timestamptz', () => {
    expect(JSON.stringify(columns.id.default)).toContain('uuidv7()');
    for (const column of [columns.createdAt, columns.updatedAt, columns.sentAt]) {
      expect(column.getSQLType()).toBe('timestamp with time zone');
    }
  });

  it('is created in a migration that grants it to lzp_auth alone, and never to lzp_app', () => {
    expect(migration).toBeDefined();
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE ON "account_email" TO lzp_auth;');
    expect(migration).not.toMatch(/GRANT[^;]*"account_email"[^;]*lzp_app/);
  });
});

describe('the rate_limit_hit table (§13: rate limits live in a Postgres table)', () => {
  const columns = getTableColumns(rateLimitHit);

  it('logs one row per allowed request in a bucket, with its time', () => {
    expect(getTableName(rateLimitHit)).toBe('rate_limit_hit');
    expect(Object.keys(columns).sort()).toEqual(['bucket', 'createdAt', 'id']);
    expect(columns.createdAt.getSQLType()).toBe('timestamp with time zone');
    expect(columns).not.toHaveProperty('workspaceId');
  });

  it('is indexed by bucket and time, and only lzp_auth reaches it', () => {
    expect(getTableConfig(rateLimitHit).indexes.map((index) => index.config.name)).toEqual([
      'rate_limit_hit_bucket_created_at_idx',
    ]);
    expect(migration).toContain('GRANT SELECT, INSERT, DELETE ON "rate_limit_hit" TO lzp_auth;');
    expect(migration).not.toMatch(/GRANT[^;]*"rate_limit_hit"[^;]*lzp_app/);
  });
});

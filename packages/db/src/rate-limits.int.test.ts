// The app role's rate limiter against real Postgres (#403, §13 The app's API: rate limits in a Postgres table, for
// uploads and anything that starts AI work). sign-in's limiter is lzp_auth's (`hitRateLimit`, 0005); this one runs as
// lzp_app, inside a workspace's unit of work, so each workspace counts only its own hits and sees no other's. Runs in
// `pnpm check:services` and CI's `services` job; every row is this run's and goes with its workspace.
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@lzp/config';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from './db.ts';
import { migrate } from './migrate.ts';
import { hitWorkspaceRateLimit } from './rate-limits.ts';
import { workspaceRateLimitHit } from './schema.ts';

const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');
const { DATABASE_URL: appUrl } = loadEnv('worker');

const run = randomUUID();
const owner = new pg.Client({ connectionString: ownerUrl });
let db: Db;
const ids = { a: '', b: '' };

beforeAll(async () => {
  await migrate(ownerUrl);
  await owner.connect();
  for (const label of ['a', 'b'] as const) {
    const { rows } = await owner.query<{ id: string }>(
      'insert into workspace (name, slug) values ($1, $2) returning id',
      [`Limits ${label} ${run}`, `limits-${label}-${run}`],
    );
    ids[label] = String(rows[0]?.id);
  }
  db = createDb(appUrl);
}, 60_000);

afterAll(async () => {
  await db.close();
  await owner.query('delete from workspace where id = any($1)', [[ids.a, ids.b]]);
  await owner.end();
});

const ctx = (label: 'a' | 'b') => ({ workspaceId: ids[label] });

/** The bucket's hits, as the owner role (which row-level security doesn't bind) finds them. */
async function hits(workspaceId: string, bucket: string): Promise<number> {
  const { rows } = await owner.query<{ n: number }>(
    'select count(*)::int as n from workspace_rate_limit_hit where workspace_id = $1 and bucket = $2',
    [workspaceId, bucket],
  );
  return rows[0]?.n ?? 0;
}

describe('hitWorkspaceRateLimit(db, ctx, bucket, limit, windowSeconds)', () => {
  it('allows `limit` hits in the window, refuses the next, and doesn’t count a refused one', async () => {
    const bucket = `uploads:${randomUUID()}`;
    for (let n = 0; n < 3; n += 1) {
      expect(await hitWorkspaceRateLimit(db, ctx('a'), bucket, 3, 60), String(n)).toBe(true);
    }
    expect(await hitWorkspaceRateLimit(db, ctx('a'), bucket, 3, 60)).toBe(false);
    expect(await hits(ids.a, bucket)).toBe(3);
  });

  it('allows again once the oldest hits are past the window, and deletes them', async () => {
    const bucket = `uploads:${randomUUID()}`;
    await owner.query(
      "insert into workspace_rate_limit_hit (workspace_id, bucket, created_at) values ($1, $2, now() - interval '2 minutes'), ($1, $2, now() - interval '2 minutes')",
      [ids.a, bucket],
    );
    expect(await hitWorkspaceRateLimit(db, ctx('a'), bucket, 2, 60)).toBe(true);
    expect(await hits(ids.a, bucket)).toBe(1);
  });

  it('counts each workspace apart: B’s hits in the same bucket name are B’s', async () => {
    const bucket = `uploads:${randomUUID()}`;
    expect(await hitWorkspaceRateLimit(db, ctx('a'), bucket, 1, 60)).toBe(true);
    expect(await hitWorkspaceRateLimit(db, ctx('a'), bucket, 1, 60)).toBe(false);
    expect(await hitWorkspaceRateLimit(db, ctx('b'), bucket, 1, 60)).toBe(true);
    expect(await hits(ids.a, bucket)).toBe(1);
    expect(await hits(ids.b, bucket)).toBe(1);
  });

  it('lets two requests at once take turns: never more than `limit` pass', async () => {
    const bucket = `uploads:${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => hitWorkspaceRateLimit(db, ctx('a'), bucket, 5, 60)),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await hits(ids.a, bucket)).toBe(5);
  });

  it('refuses a limit or a window that is no count', async () => {
    for (const [limit, seconds] of [
      [0, 60],
      [1.5, 60],
      [3, 0],
      [3, Number.NaN],
    ] as const) {
      await expect(
        hitWorkspaceRateLimit(db, ctx('a'), 'uploads:x', limit, seconds),
        `${String(limit)}/${String(seconds)}`,
      ).rejects.toThrow('hitWorkspaceRateLimit');
    }
  });

  it('runs as lzp_app, which reads, adds and deletes hits only in its own workspace', async () => {
    const bucket = `uploads:${randomUUID()}`;
    await owner.query(
      'insert into workspace_rate_limit_hit (workspace_id, bucket) values ($1, $2)',
      [ids.b, bucket],
    );
    const seen = await db.forWorkspace(ctx('a')).transaction(async (tx) => {
      const { rows } = await tx.execute<{ who: string }>(sql`select current_user as who`);
      const mine = await tx
        .select({ id: workspaceRateLimitHit.id })
        .from(workspaceRateLimitHit)
        .where(sql`${workspaceRateLimitHit.bucket} = ${bucket}`);
      const deleted = await tx
        .delete(workspaceRateLimitHit)
        .where(sql`${workspaceRateLimitHit.bucket} = ${bucket}`)
        .returning({ id: workspaceRateLimitHit.id });
      return { who: rows[0]?.who, mine, deleted };
    });
    expect(seen).toEqual({ who: 'lzp_app', mine: [], deleted: [] });
    expect(await hits(ids.b, bucket)).toBe(1);
    // Nor can A write a hit into B's bucket.
    await expect(
      db
        .forWorkspace(ctx('a'))
        .transaction((tx) =>
          tx.insert(workspaceRateLimitHit).values({ workspaceId: ids.b, bucket }),
        ),
    ).rejects.toThrow();
  });
});

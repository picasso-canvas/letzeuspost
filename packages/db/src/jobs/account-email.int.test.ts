// Sign-in's tables against real Postgres (#77), in `pnpm check:services` and CI's `services` job: only lzp_auth (the
// auth handle) reaches the account emails' outbox and the rate-limit log; the outbox's steps never send a row twice and
// let go of the link once it's sent or failed; an `account-email` job carries the row's id alone, in no group; and the
// rate limit counts exactly to its limit, even under requests at once.
//
// Every row here is this run's, made and removed here. This file sends `account-email` jobs and never works the queue
// (the worker's handler does); it removes the jobs it sent.
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { loadEnv } from '@lzp/config';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountEmail,
  accountEmailOutbox,
  createAuthDb,
  NOT_QUEUED,
  queueAccountEmail,
  rateLimitHit,
  type AuthDb,
} from '../auth.ts';
import { createDb, type Db } from '../db.ts';
import { migrate } from '../migrate.ts';
import { createJobs, installJobs, JOBS_SCHEMA, type Jobs } from './boss.ts';
import { INTERRUPTED, SENDING_STALE_AFTER_SECONDS } from './email-outbox.ts';

const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');
const { DATABASE_URL: appUrl } = loadEnv('worker');

const run = randomUUID();
const owner = new pg.Client({ connectionString: ownerUrl });
let db: Db;
let authDb: AuthDb;
let jobs: Jobs;
let workspaceId = '';
let userId = '';
const link = `http://localhost:3000/api/auth/magic-link/verify?token=${run}`;
const to = `nadia-${run}@account-email.invalid`;

/** The Postgres error code a promise was refused with. */
async function refusalCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    let current: unknown = error;
    while (typeof current === 'object' && current !== null) {
      const { code, cause } = current as { code?: unknown; cause?: unknown };
      if (typeof code === 'string') return code;
      current = cause;
    }
  }
  throw new Error('expected Postgres to refuse this, and it did not');
}

async function rowOf(id: string) {
  const { rows } = await owner.query<{
    status: string;
    failure: string | null;
    data: unknown;
    provider_id: string | null;
  }>('select status, failure, data, provider_id from account_email where id = $1', [id]);
  const row = rows[0];
  if (row === undefined) throw new Error('no row');
  return row;
}

/** A queued row of this run's, written as packages/auth writes it, with a stand-in queue. */
async function queued(): Promise<string> {
  return queueAccountEmail(
    authDb.db,
    { send: () => Promise.resolve(randomUUIDv7()) },
    { userId, template: 'sign-in-link', to, data: { url: link } },
  );
}

const PERMISSION_DENIED = '42501';

beforeAll(async () => {
  await migrate(ownerUrl);
  await installJobs(ownerUrl);
  await owner.connect();
  const person = await owner.query<{ id: string }>(
    'insert into "user" (name, email) values ($1, $2) returning id',
    [`Nadia ${run}`, to],
  );
  userId = person.rows[0]?.id ?? '';
  const space = await owner.query<{ id: string }>(
    'insert into workspace (name, slug) values ($1, $2) returning id',
    [`Account email ${run}`, `account-email-${run}`],
  );
  workspaceId = space.rows[0]?.id ?? '';
  await owner.query("insert into member (workspace_id, user_id, role) values ($1, $2, 'owner')", [
    workspaceId,
    userId,
  ]);
  db = createDb(appUrl);
  authDb = createAuthDb(appUrl);
  jobs = createJobs({ url: appUrl, db, onError: () => undefined });
  await jobs.start();
});

afterAll(async () => {
  await jobs.stop();
  await db.close();
  await authDb.close();
  await owner.query(
    `delete from ${JOBS_SCHEMA}.job where name = 'account-email'
       and data->>'accountEmailId' in (select id::text from account_email where user_id = $1)`,
    [userId],
  );
  await owner.query('delete from workspace where id = $1', [workspaceId]);
  // Deleting the person removes their account emails, by the cascade.
  await owner.query('delete from "user" where id = $1', [userId]);
  await owner.query('delete from rate_limit_hit where bucket like $1', [`test:${run}:%`]);
  await owner.end();
});

describe('sign-in’s tables, from workspace code', () => {
  it('refuses lzp_app every read and write of account_email and rate_limit_hit', async () => {
    const asWorkspace = db.forWorkspace({ workspaceId });
    const attempts = [
      () => asWorkspace.transaction((tx) => tx.select().from(accountEmail)),
      () =>
        asWorkspace.transaction((tx) =>
          tx.insert(accountEmail).values({ userId, template: 'sign-in-link', toAddress: to }),
        ),
      () => asWorkspace.transaction((tx) => tx.update(accountEmail).set({ status: 'sent' })),
      () => asWorkspace.transaction((tx) => tx.select().from(rateLimitHit)),
      () => asWorkspace.transaction((tx) => tx.insert(rateLimitHit).values({ bucket: 'x' })),
      () => asWorkspace.transaction((tx) => tx.delete(rateLimitHit)),
    ];
    for (const attempt of attempts) expect(await refusalCode(attempt())).toBe(PERMISSION_DENIED);
  });

  it('refuses lzp_app as forUser too: a signed-in person reads no sign-in link, theirs neither', async () => {
    await queued();
    expect(
      await refusalCode(
        authDb.forUser({ userId }).transaction((tx) => tx.select().from(accountEmail)),
      ),
    ).toBe(PERMISSION_DENIED);
  });
});

describe('the account emails’ outbox, on the auth handle', () => {
  it('sends a row once: loaded, claimed, sent; a second run leaves it alone', async () => {
    const id = await queued();
    const outbox = accountEmailOutbox(authDb.db);
    const jobId = randomUUIDv7();
    const found = await outbox.load(id, jobId);
    expect(found).toEqual({
      email: { id, template: 'sign-in-link', to, replyTo: null, data: { url: link } },
    });
    expect(await outbox.claim(id, jobId)).toBe(true);
    expect(await outbox.claim(id, randomUUIDv7())).toBe(false);
    expect(await outbox.sent(id, '<provider-id>')).toBe(true);
    expect(await outbox.load(id, randomUUIDv7())).toEqual({ skip: 'sent' });
    const row = await rowOf(id);
    expect(row).toEqual({ status: 'sent', failure: null, data: {}, provider_id: '<provider-id>' });
  });

  it('lets go of the link when a row fails, and never sends a failed row', async () => {
    const id = await queued();
    const outbox = accountEmailOutbox(authDb.db);
    await outbox.fail(id, 'not sent (smtp-550)');
    expect(await rowOf(id)).toEqual({
      status: 'failed',
      failure: 'not sent (smtp-550)',
      data: {},
      provider_id: null,
    });
    expect(await outbox.load(id, randomUUIDv7())).toEqual({ skip: 'failed' });
    expect(await outbox.claim(id, randomUUIDv7())).toBe(false);
  });

  it("puts a row back after a send that certainly didn't go out, link and all", async () => {
    const id = await queued();
    const outbox = accountEmailOutbox(authDb.db);
    const jobId = randomUUIDv7();
    expect(await outbox.claim(id, jobId)).toBe(true);
    await outbox.release(id);
    expect(await outbox.load(id, jobId)).toEqual({
      email: { id, template: 'sign-in-link', to, replyTo: null, data: { url: link } },
    });
  });

  it("marks interrupted a row its own job's earlier run claimed, or a stale one, and leaves another run's", async () => {
    const outbox = accountEmailOutbox(authDb.db);
    const mine = await queued();
    const jobId = randomUUIDv7();
    await outbox.claim(mine, jobId);
    expect(await outbox.load(mine, jobId)).toEqual({ skip: 'interrupted' });
    expect(await rowOf(mine)).toMatchObject({ status: 'failed', failure: INTERRUPTED, data: {} });

    const theirs = await queued();
    await outbox.claim(theirs, randomUUIDv7());
    expect(await outbox.load(theirs, randomUUIDv7())).toEqual({ skip: 'sending' });
    await owner.query(
      'update account_email set updated_at = now() - make_interval(secs => $2) where id = $1',
      [theirs, SENDING_STALE_AFTER_SECONDS + 1],
    );
    expect(await outbox.load(theirs, randomUUIDv7())).toEqual({ skip: 'interrupted' });
  });

  it('fails the row when its job cannot be queued, so nothing waits for a job that never comes', async () => {
    const refused = new Error('the queue is down');
    await expect(
      queueAccountEmail(
        authDb.db,
        { send: () => Promise.reject(refused) },
        { userId, template: 'sign-in-link', to, data: { url: link } },
      ),
    ).rejects.toBe(refused);
    const { rows } = await owner.query<{ status: string; failure: string; data: unknown }>(
      'select status, failure, data from account_email where user_id = $1 and failure = $2',
      [userId, NOT_QUEUED],
    );
    expect(rows).toEqual([{ status: 'failed', failure: NOT_QUEUED, data: {} }]);
  });

  it('queues an account-email job with the row’s id alone, in no workspace’s group', async () => {
    const id = await queueAccountEmail(authDb.db, jobs, {
      userId,
      template: 'sign-in-link',
      to,
      data: { url: link },
    });
    const { rows } = await owner.query<{ data: unknown; group_id: string | null }>(
      `select data, group_id from ${JOBS_SCHEMA}.job where name = 'account-email' and data->>'accountEmailId' = $1`,
      [id],
    );
    expect(rows).toEqual([{ data: { accountEmailId: id }, group_id: null }]);
  });
});

describe('hitRateLimit (§13: rate limits in a Postgres table)', () => {
  it('counts a bucket up to its limit, then refuses, and keeps buckets apart', async () => {
    const bucket = `test:${run}:address`;
    const answers = [];
    for (let i = 0; i < 6; i += 1) answers.push(await authDb.hitRateLimit(bucket, 5, 3600));
    expect(answers).toEqual([true, true, true, true, true, false]);
    expect(await authDb.hitRateLimit(`test:${run}:other`, 5, 3600)).toBe(true);
  });

  it('allows exactly the limit when requests arrive at once', async () => {
    const bucket = `test:${run}:together`;
    const answers = await Promise.all(
      Array.from({ length: 30 }, () => authDb.hitRateLimit(bucket, 20, 3600)),
    );
    expect(answers.filter(Boolean)).toHaveLength(20);
  });

  it('allows again once the oldest hits leave the window, and removes them', async () => {
    const bucket = `test:${run}:window`;
    for (let i = 0; i < 5; i += 1) await authDb.hitRateLimit(bucket, 5, 3600);
    expect(await authDb.hitRateLimit(bucket, 5, 3600)).toBe(false);
    await owner.query(
      "update rate_limit_hit set created_at = now() - interval '61 minutes' where bucket = $1",
      [bucket],
    );
    expect(await authDb.hitRateLimit(bucket, 5, 3600)).toBe(true);
    const { rows } = await owner.query<{ hits: number }>(
      'select count(*)::int as hits from rate_limit_hit where bucket = $1',
      [bucket],
    );
    expect(rows).toEqual([{ hits: 1 }]);
  });

  it('runs as lzp_auth, never as the app role', async () => {
    const { rows } = await authDb.db.execute<{ who: string }>(sql`select current_user as who`);
    expect(rows).toEqual([{ who: 'lzp_auth' }]);
  });
});

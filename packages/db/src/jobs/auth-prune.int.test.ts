// The auth tables' prune against real Postgres (#323), in `pnpm check:services` and CI's `services` job: on the auth
// handle (lzp_auth), every rate-limit hit older than the longest window goes, in every bucket, and every hit inside it
// stays; sent and failed account emails go once they are older than the retention window, and nothing that may still
// be sent does. Run twice, it deletes nothing more; beside live sign-ins, it never waits on a row they hold, and the
// limits still count exactly.
//
// Other files share this database, so a prune here may delete their old rows too (as the worker's would): every check
// below reads this run's rows alone, and the counts returned only from below.
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@lzp/config';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCOUNT_EMAIL_KEEP_DAYS,
  createAuthDb,
  pruneAccountEmails,
  pruneRateLimitHits,
  RATE_LIMIT_LONGEST_WINDOW_SECONDS,
  type AuthDb,
} from '../auth.ts';
import { migrate } from '../migrate.ts';

const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');
const { DATABASE_URL: appUrl } = loadEnv('worker');

const run = randomUUID();
const owner = new pg.Client({ connectionString: ownerUrl });
let authDb: AuthDb;
let userId = '';

const W = RATE_LIMIT_LONGEST_WINDOW_SECONDS;
const DAY = 24 * 60 * 60;
const KEEP = ACCOUNT_EMAIL_KEEP_DAYS * DAY;

const bucketOf = (name: string) => `test:${run}:${name}`;

/** Writes one hit in `bucket` per age, `ages` seconds old by the database's clock; returns their ids. */
async function hits(bucket: string, ages: readonly number[]): Promise<string[]> {
  const ids: string[] = [];
  for (const age of ages) {
    const { rows } = await owner.query<{ id: string }>(
      'insert into rate_limit_hit (bucket, created_at) values ($1, now() - make_interval(secs => $2)) returning id',
      [bucket, age],
    );
    ids.push(rows[0]?.id ?? '');
  }
  return ids;
}

/** This run's hits left, as ids. */
async function hitsLeft(): Promise<string[]> {
  const { rows } = await owner.query<{ id: string }>(
    'select id from rate_limit_hit where bucket like $1 order by id',
    [`test:${run}:%`],
  );
  return rows.map((row) => row.id);
}

/** Writes an account email of this run's, in `status`, last moved `age` seconds ago; returns its id. */
async function email(status: string, age: number): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `insert into account_email (user_id, template, to_address, status, created_at, updated_at)
       values ($1, 'sign-in-link', $2, $3, now() - make_interval(secs => $4), now() - make_interval(secs => $4))
       returning id`,
    [userId, `nadia-${run}@auth-prune.invalid`, status, age],
  );
  return rows[0]?.id ?? '';
}

/** This run's account emails left, as ids. */
async function emailsLeft(): Promise<string[]> {
  const { rows } = await owner.query<{ id: string }>(
    'select id from account_email where user_id = $1 order by id',
    [userId],
  );
  return rows.map((row) => row.id);
}

const sorted = (ids: readonly string[]) => [...ids].sort();

beforeAll(async () => {
  await migrate(ownerUrl);
  await owner.connect();
  const person = await owner.query<{ id: string }>(
    'insert into "user" (name, email) values ($1, $2) returning id',
    [`Nadia ${run}`, `nadia-${run}@auth-prune.invalid`],
  );
  userId = person.rows[0]?.id ?? '';
  authDb = createAuthDb(appUrl);
});

afterAll(async () => {
  await authDb.close();
  // Deleting the person removes their account emails, by the cascade.
  await owner.query('delete from "user" where id = $1', [userId]);
  await owner.query('delete from rate_limit_hit where bucket like $1', [`test:${run}:%`]);
  await owner.end();
});

describe('pruneRateLimitHits (#323)', () => {
  it('runs as lzp_auth, the role that holds the table', async () => {
    const { rows } = await authDb.db.execute<{ who: string }>(sql`select current_user as who`);
    expect(rows).toEqual([{ who: 'lzp_auth' }]);
  });

  it('deletes every hit older than the longest window, in every bucket, and keeps every hit inside it', async () => {
    await owner.query('delete from rate_limit_hit where bucket like $1', [`test:${run}:%`]);
    // A bucket never hit again, and one hit now and then: the prune doesn't wait for a request in either.
    await hits(bucketOf('abandoned'), [W + 1, W + 60, 30 * DAY]);
    const inside = [
      ...(await hits(bucketOf('abandoned'), [W - 60])),
      ...(await hits(bucketOf('busy'), [0, 1, W - 60])),
    ];
    await hits(bucketOf('busy'), [W + 1, W + 3600]);

    // Batches of 2, so the five expired hits take more than one.
    const deleted = await pruneRateLimitHits(authDb.db, { batch: 2 });

    expect(deleted).toBeGreaterThanOrEqual(5);
    expect(await hitsLeft()).toEqual(sorted(inside));
  });

  it('is safe to run twice: the second run deletes nothing that is still inside the window', async () => {
    await owner.query('delete from rate_limit_hit where bucket like $1', [`test:${run}:%`]);
    const inside = await hits(bucketOf('twice'), [0, W - 60]);
    await hits(bucketOf('twice'), [W + 60]);

    await pruneRateLimitHits(authDb.db);
    expect(await hitsLeft()).toEqual(sorted(inside));
    await pruneRateLimitHits(authDb.db);
    expect(await hitsLeft()).toEqual(sorted(inside));
  });

  it('never waits on a hit a live sign-in holds: it leaves it for the next run', async () => {
    await owner.query('delete from rate_limit_hit where bucket like $1', [`test:${run}:%`]);
    const [held = '', free = ''] = await hits(bucketOf('held'), [W + 60, W + 60]);
    // A sign-in's transaction holding the row, as hitRateLimit's own delete does while it counts.
    const signIn = new pg.Client({ connectionString: ownerUrl });
    await signIn.connect();
    try {
      await signIn.query('begin');
      await signIn.query('select id from rate_limit_hit where id = $1 for update', [held]);

      await pruneRateLimitHits(authDb.db);
      expect(await hitsLeft()).toEqual([held]);
      expect(await hitsLeft()).not.toContain(free);

      await signIn.query('commit');
    } finally {
      await signIn.end();
    }
    await pruneRateLimitHits(authDb.db);
    expect(await hitsLeft()).toEqual([]);
  });

  it('runs beside live sign-ins: nothing fails, and each bucket still counts exactly to its limit', async () => {
    await owner.query('delete from rate_limit_hit where bucket like $1', [`test:${run}:%`]);
    const bucket = bucketOf('live');
    // Three hits inside the window and many outside: a limit of 5 leaves room for exactly 2 more.
    await hits(bucket, [W - 60, W - 120, W - 180]);
    await hits(
      bucket,
      Array.from({ length: 40 }, (_, i) => W + 1 + i),
    );
    await hits(
      bucketOf('live-other'),
      Array.from({ length: 40 }, (_, i) => W + 1 + i),
    );

    const [answers] = await Promise.all([
      Promise.all(Array.from({ length: 10 }, () => authDb.hitRateLimit(bucket, 5, W))),
      pruneRateLimitHits(authDb.db, { batch: 3 }),
      pruneRateLimitHits(authDb.db, { batch: 5 }),
    ]);

    expect(answers.filter(Boolean)).toHaveLength(2);
    await pruneRateLimitHits(authDb.db);
    const { rows } = await owner.query<{ bucket: string; hits: number }>(
      'select bucket, count(*)::int as hits from rate_limit_hit where bucket like $1 group by bucket',
      [`test:${run}:%`],
    );
    expect(rows).toEqual([{ bucket, hits: 5 }]);
  });
});

describe('pruneAccountEmails (#323)', () => {
  it('deletes sent and failed emails older than the retention window, and keeps every other', async () => {
    await email('sent', KEEP + 60);
    await email('failed', KEEP + 60);
    await email('sent', 400 * DAY);
    const kept = [
      await email('sent', KEEP - 60),
      await email('failed', 60),
      // Not sent yet, however old: the account-email job, or a person, still decides what becomes of it.
      await email('queued', KEEP + 60),
      await email('sending', KEEP + 60),
    ];

    const deleted = await pruneAccountEmails(authDb.db, { batch: 2 });

    expect(deleted).toBeGreaterThanOrEqual(3);
    expect(await emailsLeft()).toEqual(sorted(kept));
  });

  it('is safe to run twice: the second run deletes nothing more of what the first kept', async () => {
    const before = await emailsLeft();
    await pruneAccountEmails(authDb.db);
    await pruneAccountEmails(authDb.db);
    expect(await emailsLeft()).toEqual(before);
  });

  it('never waits on an email the outbox holds: it leaves it for the next run', async () => {
    const held = await email('failed', KEEP + 60);
    const free = await email('sent', KEEP + 60);
    const outbox = new pg.Client({ connectionString: ownerUrl });
    await outbox.connect();
    try {
      await outbox.query('begin');
      await outbox.query('select id from account_email where id = $1 for update', [held]);

      await pruneAccountEmails(authDb.db);
      const left = await emailsLeft();
      expect(left).toContain(held);
      expect(left).not.toContain(free);

      await outbox.query('commit');
    } finally {
      await outbox.end();
    }
    await pruneAccountEmails(authDb.db);
    expect(await emailsLeft()).not.toContain(held);
  });
});

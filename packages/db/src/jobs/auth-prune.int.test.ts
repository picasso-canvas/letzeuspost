// The auth tables' prune against real Postgres (#323), in `pnpm check:services` and CI's `services` job: on the auth
// handle (lzp_auth), every rate-limit hit older than the longest window goes, in every bucket, and every hit inside it
// stays; sent and failed account emails go once they are older than the retention window, and nothing that may still
// be sent does. Run twice, it deletes nothing more; beside live sign-ins, it never waits on a bucket or a row they
// hold (so it cannot deadlock with them), and the limits still count exactly.
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
import { RATE_LIMIT_LOCK } from './auth-prune.ts';

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

  it('holds no UPDATE on the table, so it takes no row lock there (CI F1)', async () => {
    const { rows } = await owner.query<{ update: boolean; del: boolean }>(
      `select has_table_privilege('lzp_auth', 'rate_limit_hit', 'UPDATE') as update,
              has_table_privilege('lzp_auth', 'rate_limit_hit', 'DELETE') as del`,
    );
    expect(rows).toEqual([{ update: false, del: true }]);
  });

  it('never waits on a bucket a live sign-in holds, so it cannot deadlock with hitRateLimit', async () => {
    await owner.query('delete from rate_limit_hit where bucket like $1', [`test:${run}:%`]);
    const bucket = bucketOf('held');
    const [first = '', ...rest] = await hits(bucket, [W + 60, W + 120, W + 180]);
    const inside = await hits(bucket, [60]);
    await hits(bucketOf('free'), [W + 60, W + 120]);

    // A sign-in halfway through hitRateLimit: its bucket's lock taken, one expired hit of its bucket deleted (so that
    // row is locked until it commits), the rest still to go. A prune that deleted this bucket's rows would wait on it.
    const signIn = new pg.Client({ connectionString: ownerUrl });
    await signIn.connect();
    try {
      await signIn.query('begin');
      await signIn.query('select pg_advisory_xact_lock($1, hashtext($2))', [
        RATE_LIMIT_LOCK,
        bucket,
      ]);
      await signIn.query('delete from rate_limit_hit where id = $1', [first]);

      // The prune returns while the sign-in still holds its bucket: it waited on nothing.
      const pruned = await Promise.race([
        pruneRateLimitHits(authDb.db, { batch: 50 }).then(() => 'returned'),
        new Promise((resolve) => setTimeout(resolve, 10_000, 'waited')),
      ]);
      expect(pruned).toBe('returned');
      // The other bucket's expired hits went; the held bucket's are all still there.
      expect(await hitsLeft()).toEqual(sorted([first, ...rest, ...inside]));

      // The sign-in finishes its own delete: none of its rows is locked by the prune, so it doesn't wait either.
      const finished = await signIn.query(
        'delete from rate_limit_hit where bucket = $1 and created_at <= now() - make_interval(secs => $2)',
        [bucket, W],
      );
      expect(finished.rowCount).toBe(rest.length);
      await signIn.query('commit');
    } finally {
      await signIn.end();
    }
    expect(await hitsLeft()).toEqual(sorted(inside));
  });

  it('leaves a held bucket to the next run, and that run deletes it', async () => {
    await owner.query('delete from rate_limit_hit where bucket like $1', [`test:${run}:%`]);
    const bucket = bucketOf('held-later');
    await hits(bucket, [W + 60, W + 120]);
    const signIn = new pg.Client({ connectionString: ownerUrl });
    await signIn.connect();
    try {
      await signIn.query('begin');
      await signIn.query('select pg_advisory_xact_lock($1, hashtext($2))', [
        RATE_LIMIT_LOCK,
        bucket,
      ]);
      await pruneRateLimitHits(authDb.db);
      expect(await hitsLeft()).toHaveLength(2);
      await signIn.query('commit');
    } finally {
      await signIn.end();
    }
    await pruneRateLimitHits(authDb.db);
    expect(await hitsLeft()).toEqual([]);
  });

  it('runs beside live sign-ins in many buckets: nothing fails, and each still counts exactly to its limit', async () => {
    await owner.query('delete from rate_limit_hit where bucket like $1', [`test:${run}:%`]);
    const live = Array.from({ length: 6 }, (_, i) => bucketOf(`live-${String(i)}`));
    for (const bucket of live) {
      // Three hits inside the window and many outside: a limit of 5 leaves room for exactly 2 more.
      await hits(bucket, [W - 60, W - 120, W - 180]);
      await hits(
        bucket,
        Array.from({ length: 20 }, (_, i) => W + 1 + i),
      );
    }
    await hits(
      bucketOf('live-other'),
      Array.from({ length: 40 }, (_, i) => W + 1 + i),
    );

    // Each sign-in deletes its bucket's expired hits, the very rows the prunes are after.
    const [answers] = await Promise.all([
      Promise.all(
        live.flatMap((bucket) =>
          Array.from({ length: 5 }, () => authDb.hitRateLimit(bucket, 5, W)),
        ),
      ),
      pruneRateLimitHits(authDb.db, { batch: 3 }),
      pruneRateLimitHits(authDb.db, { batch: 7 }),
      pruneRateLimitHits(authDb.db),
    ]);

    expect(answers.filter(Boolean)).toHaveLength(2 * live.length);
    await pruneRateLimitHits(authDb.db);
    const { rows } = await owner.query<{ bucket: string; hits: number }>(
      'select bucket, count(*)::int as hits from rate_limit_hit where bucket like $1 group by bucket order by bucket',
      [`test:${run}:%`],
    );
    expect(rows).toEqual([...live].sort().map((bucket) => ({ bucket, hits: 5 })));
  });
});

describe('pruneAccountEmails (#323)', () => {
  it('runs on a DELETE grant of its own (CI F1): lzp_auth may delete account emails', async () => {
    const { rows } = await owner.query<{ del: boolean }>(
      "select has_table_privilege('lzp_auth', 'account_email', 'DELETE') as del",
    );
    expect(rows).toEqual([{ del: true }]);
  });

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

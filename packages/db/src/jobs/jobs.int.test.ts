// pg-boss on the same Postgres (§13 Jobs, #72), against real Postgres in `pnpm check:services` and CI's `services`
// job: the owner role installs the `pgboss` schema and the app role only uses it; payloads hold ids only; a job runs
// in its own workspace; the ai queue runs at most 4 of a workspace's jobs at once; retries stop at the limit; and the
// email outbox's steps.
//
// Vitest runs the services files side by side on one database (Argus F1 on #202), so nothing here touches another
// file's rows or jobs: every workspace and row is this run's, made and removed here. pg-boss's tables are shared,
// though, and a handler that skips another file's job still completes it, so the other file would wait for it in
// vain. So each queue a test handler works on belongs to one file: `fetch`, `ai` and `render` to this one, `export` to
// tests/journeys/data.int.test.ts. `email` is the worker's real handler (apps/worker/src/email.int.test.ts and the
// journey run it), which does the same with a job whichever file's worker takes it. A handler here still skips jobs
// of another run of this file.
import { execFileSync } from 'node:child_process';
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@lzp/config';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db.ts';
import { migrate } from '../migrate.ts';
import { emailMessage } from '../schema/email-message.ts';
import { createJobs, installJobs, JOBS_SCHEMA, type Jobs } from './boss.ts';
import { emailOutbox, INTERRUPTED, SENDING_STALE_AFTER_SECONDS } from './email-outbox.ts';
import { JobPayloadError, queueNames, queues } from './queues.ts';

const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');
const { DATABASE_URL: appUrl } = loadEnv('worker');

const run = randomUUID();
const owner = new pg.Client({ connectionString: ownerUrl });
let db: Db;
let jobs: Jobs;
const ids = { a: '', b: '', rowA: '', rowB: '' };

/** Polls `check` until it returns something truthy; fails after `timeoutMs`. */
async function waitFor<T>(
  what: string,
  check: () => T | Promise<T>,
  timeoutMs = 30_000,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The Postgres error code a promise was refused with. */
async function refusalCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return String((error as { code?: unknown }).code);
  }
  throw new Error('expected Postgres to refuse this, and it did not');
}

async function insertRow(workspaceId: string, to: string): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `insert into email_message (workspace_id, template, to_address, data)
     values ($1, 'email-check', $2, '{"name": "Picasso Studio"}') returning id`,
    [workspaceId, to],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('no row');
  return id;
}

async function statusOf(id: string): Promise<{ status: string; failure: string | null }> {
  const { rows } = await owner.query<{ status: string; failure: string | null }>(
    'select status, failure from email_message where id = $1',
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('no row');
  return row;
}

/** As if the run that set the row's status had done so `seconds` ago. */
async function age(id: string, seconds: number): Promise<void> {
  await owner.query(
    `update email_message set updated_at = now() - make_interval(secs => $2) where id = $1`,
    [id, seconds],
  );
}

async function providerIdOf(id: string): Promise<string | null> {
  const { rows } = await owner.query<{ providerId: string | null }>(
    'select provider_id as "providerId" from email_message where id = $1',
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('no row');
  return row.providerId;
}

/** The pg-boss job whose run claimed the row, if any. */
async function claimedBy(id: string): Promise<string | null> {
  const { rows } = await owner.query<{ job: string | null }>(
    'select claimed_by_job as job from email_message where id = $1',
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('no row');
  return row.job;
}

/** The owner of the `pgboss` schema and of each of its tables. */
async function jobsOwners(): Promise<{ schema: string[]; tables: string[] }> {
  const schema = await owner.query<{ owner: string }>(
    'select nspowner::regrole::text as owner from pg_namespace where nspname = $1',
    [JOBS_SCHEMA],
  );
  const tables = await owner.query<{ owner: string }>(
    'select distinct tableowner as owner from pg_tables where schemaname = $1',
    [JOBS_SCHEMA],
  );
  return {
    schema: schema.rows.map((row) => row.owner),
    tables: tables.rows.map((row) => row.owner),
  };
}

beforeAll(async () => {
  await owner.connect();
  await migrate(ownerUrl);
  // Two installs at once take turns, and a third changes nothing.
  await Promise.all([installJobs(ownerUrl), installJobs(ownerUrl)]);
  await installJobs(ownerUrl);
  for (const key of ['a', 'b'] as const) {
    const { rows } = await owner.query<{ id: string }>(
      'insert into workspace (name, slug) values ($1, $2) returning id',
      [`Jobs ${key} ${run}`, `jobs-${key}-${run}`],
    );
    ids[key] = rows[0]?.id ?? '';
  }
  ids.rowA = await insertRow(ids.a, `a-${run}@example.test`);
  ids.rowB = await insertRow(ids.b, `b-${run}@example.test`);
  db = createDb(appUrl);
  jobs = createJobs({
    url: appUrl,
    db,
    pollingIntervalSeconds: 0.5,
    onError: (error) => {
      console.error(`jobs: ${error.name}`);
    },
  });
  await jobs.start(); // as the app role, with migrate off: it finds pg-boss installed at its version
}, 60_000);

afterAll(async () => {
  await jobs.stop();
  await db.close();
  await owner.query('delete from workspace where id = any($1::uuid[])', [[ids.a, ids.b]]);
  await owner.end();
});

describe('pg-boss in the pgboss schema (§13)', () => {
  it('is installed by the migrate command a deploy runs, as the owner role', async () => {
    // `pnpm --filter @lzp/db migrate`, with this run's DATABASE_OWNER_URL. migrate-command.test.ts checks that it
    // calls installJobs right after the migrations; here it runs for real and leaves pg-boss the owner's.
    const command = fileURLToPath(new URL('../bin/migrate.ts', import.meta.url));
    const output = execFileSync(process.execPath, [command], { encoding: 'utf8' });
    expect(output).toContain('Migrations applied.');
    expect(await jobsOwners()).toEqual({ schema: ['lzp_owner'], tables: ['lzp_owner'] });
  }, 60_000);

  it("is installed by the owner role: the schema and every table in it are lzp_owner's", async () => {
    const schema = await owner.query<{ owner: string }>(
      'select nspowner::regrole::text as owner from pg_namespace where nspname = $1',
      [JOBS_SCHEMA],
    );
    expect(schema.rows).toEqual([{ owner: 'lzp_owner' }]);
    const tables = await owner.query<{ owner: string; count: number }>(
      'select tableowner as owner, count(*)::int as count from pg_tables where schemaname = $1 group by tableowner',
      [JOBS_SCHEMA],
    );
    expect(tables.rows.map((row) => row.owner)).toEqual(['lzp_owner']);
    expect(tables.rows[0]?.count).toBeGreaterThan(3);
  });

  it("gives the app role pg-boss's rows, never its schema", async () => {
    const privilege = await owner.query<{ create: boolean; usage: boolean }>(
      `select has_schema_privilege('lzp_app', $1, 'CREATE') as create,
              has_schema_privilege('lzp_app', $1, 'USAGE') as usage`,
      [JOBS_SCHEMA],
    );
    expect(privilege.rows).toEqual([{ create: false, usage: true }]);
    const app = new pg.Client({ connectionString: appUrl });
    await app.connect();
    try {
      expect(await refusalCode(app.query(`create table ${JOBS_SCHEMA}.intruder (i int)`))).toBe(
        '42501',
      );
      expect(
        await refusalCode(app.query(`alter table ${JOBS_SCHEMA}.job add column intruder int`)),
      ).toBe('42501');
      expect(await refusalCode(app.query(`drop table ${JOBS_SCHEMA}.queue`))).toBe('42501');
    } finally {
      await app.end();
    }
  });

  // Cerberus F1 on #197: the queue's policy and pg-boss's version are the owner's; lzp_app only stamps its passes.
  it("refuses the app role any change to a queue's retry bounds, to the queue list or to pg-boss's version", async () => {
    const app = new pg.Client({ connectionString: appUrl });
    await app.connect();
    try {
      for (const statement of [
        `update ${JOBS_SCHEMA}.queue set retry_limit = 100 where name = 'email'`,
        `update ${JOBS_SCHEMA}.queue set expire_seconds = 1 where name = 'email'`,
        `update ${JOBS_SCHEMA}.queue set dead_letter = null where name = 'email'`,
        `insert into ${JOBS_SCHEMA}.queue (name) values ('intruder')`,
        `delete from ${JOBS_SCHEMA}.queue where name = 'email'`,
        `update ${JOBS_SCHEMA}.version set version = version`,
        `delete from ${JOBS_SCHEMA}.version`,
      ]) {
        expect(await refusalCode(app.query(statement)), statement).toBe('42501');
      }
      // What a running instance writes there: its pass stamps and the queue's counts.
      await app.query(
        `update ${JOBS_SCHEMA}.queue set monitor_claim_on = monitor_claim_on where name = 'email'`,
      );
      await app.query(`update ${JOBS_SCHEMA}.version set cron_on = cron_on`);
    } finally {
      await app.end();
    }
  });

  it("lets the app role run pg-boss's maintenance pass (expiry, retries, counts) with no permission refused", async () => {
    const boss = new PgBoss({
      connectionString: appUrl,
      schema: JOBS_SCHEMA,
      migrate: false,
      reindex: false,
      schedule: false,
      supervise: false,
    });
    const refused: string[] = [];
    const note = (error: unknown) => {
      if ((error as { code?: unknown }).code === '42501') refused.push((error as Error).message);
    };
    boss.on('error', note);
    await boss.start();
    try {
      await boss.supervise().catch(note);
    } finally {
      await boss.stop({ graceful: false });
    }
    expect(refused).toEqual([]);
  }, 60_000);

  it('declares the five queues, each with its bounded retries, backoff and expiry', async () => {
    const { rows } = await owner.query<{
      name: string;
      retryLimit: number;
      retryDelay: number;
      retryBackoff: boolean;
      retryDelayMax: number;
      expireInSeconds: number;
    }>(
      `select name, retry_limit as "retryLimit", retry_delay as "retryDelay", retry_backoff as "retryBackoff",
              retry_delay_max as "retryDelayMax", expire_seconds as "expireInSeconds"
       from ${JOBS_SCHEMA}.queue where name = any($1::text[]) order by name`,
      [[...queueNames]],
    );
    expect(rows).toEqual([...queueNames].sort().map((name) => ({ name, ...queues[name].queue })));
  });

  it('refuses a payload carrying content, and queues nothing', async () => {
    const count = async () =>
      (
        await owner.query<{ n: number }>(
          `select count(*)::int as n from ${JOBS_SCHEMA}.job where name = 'fetch' and data->>'workspaceId' = $1`,
          [ids.a],
        )
      ).rows[0]?.n;
    const before = await count();
    await expect(
      jobs.send('fetch', {
        workspaceId: ids.a,
        brandId: randomUUIDv7(),
        caption: 'আমাদের নতুন মেনু',
      } as never),
    ).rejects.toThrow(JobPayloadError);
    expect(await count()).toBe(before);
  });
});

describe('a job runs in its own workspace (§13, the tenant-isolation skill)', () => {
  const seen = new Map<string, { rows: { id: string; workspaceId: string }[]; byId: string[] }>();

  // The `fetch` queue: this file's own (see the top), so no other file's handler takes these jobs.
  beforeAll(async () => {
    await jobs.work('fetch', async ({ payload, db: scoped }) => {
      if (!expectedFetches.has(payload.brandId)) return; // another run of this file
      const result = await scoped.transaction(async (tx) => ({
        // No filter at all: row-level security alone decides what comes back.
        rows: await tx
          .select({ id: emailMessage.id, workspaceId: emailMessage.workspaceId })
          .from(emailMessage),
        // The other workspace's row, asked for by its id.
        byId: (
          await tx.execute<{ id: string }>(
            sql`select id from email_message where id = ${expectedFetches.get(payload.brandId) ?? ''}`,
          )
        ).rows.map((row) => row.id),
      }));
      seen.set(payload.brandId, result);
    });
  });

  const expectedFetches = new Map<string, string>(); // brand id → the other workspace's row

  it.each([
    ['A', 'a', 'rowA', 'rowB'],
    ['B', 'b', 'rowB', 'rowA'],
  ] as const)(
    "a job for %s sees only its own workspace's rows, even asked for the other's by id",
    async (_, workspace, own, other) => {
      const brandId = randomUUIDv7();
      expectedFetches.set(brandId, ids[other]);
      await jobs.send('fetch', { workspaceId: ids[workspace], brandId });
      const result = await waitFor('the fetch job', () => seen.get(brandId));
      expect(result.rows).toEqual([{ id: ids[own], workspaceId: ids[workspace] }]);
      expect(result.byId).toEqual([]);
    },
  );
});

describe('the ai queue runs at most 4 jobs at a time per workspace (§13)', () => {
  it("with 6 queued for A and 1 for B, A never has more than 4 running and B's starts without waiting", async () => {
    const batchId = randomUUIDv7(); // marks this run's jobs
    const running = new Map<string, number>();
    const most = new Map<string, number>();
    let finishedA = 0;
    let bStarted: { runningA: number; finishedA: number } | undefined;
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });

    await jobs.work('ai', async ({ payload }) => {
      if (payload.batchId !== batchId) return;
      const ws = payload.workspaceId;
      running.set(ws, (running.get(ws) ?? 0) + 1);
      most.set(ws, Math.max(most.get(ws) ?? 0, running.get(ws) ?? 0));
      try {
        if (ws === ids.b) {
          bStarted = { runningA: running.get(ids.a) ?? 0, finishedA };
        } else {
          await gate; // A's jobs hold their slots until the test lets them go
          finishedA += 1;
        }
      } finally {
        running.set(ws, (running.get(ws) ?? 0) - 1);
      }
    });

    for (let i = 0; i < 6; i += 1) {
      await jobs.send('ai', { workspaceId: ids.a, batchId, postId: randomUUIDv7() });
    }
    await waitFor("A's first 4 jobs running", () => running.get(ids.a) === 4);
    await jobs.send('ai', { workspaceId: ids.b, batchId, postId: randomUUIDv7() });

    const started = await waitFor("B's job", () => bStarted);
    expect(started.finishedA).toBe(0); // B didn't wait for any of A's
    expect(started.runningA).toBe(4);
    expect(most.get(ids.a)).toBe(4);

    open();
    await waitFor("all of A's jobs", () => finishedA === 6);
    expect(most.get(ids.a)).toBe(4); // never a fifth, before or after the gate opened
  }, 60_000);
});

describe('retries are bounded, with backoff (§13)', () => {
  it('a job that keeps failing is retried with growing waits, then stops at the limit', async () => {
    const postId = randomUUIDv7();
    const runs: number[] = [];
    await jobs.work('render', ({ payload, retryCount }) => {
      if (payload.postId !== postId) return Promise.resolve();
      runs.push(retryCount);
      return Promise.reject(new Error('render failed on purpose'));
    });
    const jobId = await jobs.send('render', {
      workspaceId: ids.a,
      postId,
      postVersionId: randomUUIDv7(),
    });
    const state = async () =>
      (
        await owner.query<{ state: string; retryCount: number; wait: number }>(
          `select state, retry_count as "retryCount", extract(epoch from start_after - now())::float as wait
           from ${JOBS_SCHEMA}.job where name = 'render' and id = $1`,
          [jobId],
        )
      ).rows[0];

    const { retryLimit, retryDelay, retryDelayMax } = queues.render.queue;
    const waits: number[] = [];
    for (let retry = 1; retry <= retryLimit; retry += 1) {
      const waiting = await waitFor(`retry ${String(retry)}`, async () => {
        const now = await state();
        return now?.state === 'retry' && now.retryCount === retry - 1 ? now : undefined;
      });
      waits.push(waiting.wait);
      // The wait has been checked; skip it rather than sit through minutes of backoff.
      await owner.query(
        `update ${JOBS_SCHEMA}.job set start_after = now() where name = 'render' and id = $1 and state = 'retry'`,
        [jobId],
      );
    }
    const last = await waitFor('the job to fail for good', async () => {
      const now = await state();
      return now?.state === 'failed' ? now : undefined;
    });

    expect(runs).toEqual([0, 1, 2, 3]); // the first run and retryLimit retries, then no more
    expect(last.retryCount).toBe(retryLimit);
    // pg-boss's backoff: retryDelay × 1-2, × 2-4, × 4-8, never past retryDelayMax (a second's slack for the clock).
    expect(waits[0]).toBeGreaterThan(retryDelay - 2);
    for (let i = 1; i < waits.length; i += 1) {
      expect(waits[i]).toBeGreaterThan((waits[i - 1] ?? 0) - 2);
    }
    for (const wait of waits) expect(wait).toBeLessThanOrEqual(retryDelayMax + 1);
  }, 120_000);
});

describe('the email outbox (§13 Data model)', () => {
  // Each run of a job is named by its pg-boss job id, which a retry keeps (`first`, then `first` again); another job
  // for the same row has its own id (`other`).
  const runs = () => ({ first: randomUUID(), other: randomUUID() });

  it('sends a row only from queued: a second claim and a sent row are refused', async () => {
    const { first, other } = runs();
    const id = await insertRow(ids.a, `claim-${run}@example.test`);
    const outbox = emailOutbox(db.forWorkspace({ workspaceId: ids.a }));
    expect(await outbox.load(id, first)).toEqual({
      email: {
        id,
        template: 'email-check',
        to: `claim-${run}@example.test`,
        replyTo: null,
        data: { name: 'Picasso Studio' },
      },
    });
    const claims = await Promise.all([outbox.claim(id, first), outbox.claim(id, other)]);
    expect(claims.sort()).toEqual([false, true]); // two runs at once: one claim wins
    await outbox.sent(id, '<provider-id@example.test>');
    expect(await outbox.load(id, first)).toEqual({ skip: 'sent' });
    expect(await outbox.claim(id, first)).toBe(false);
  });

  it('records which job claimed a row, and forgets it when the row goes back in the queue', async () => {
    const { first, other } = runs();
    const id = await insertRow(ids.a, `release-${run}@example.test`);
    const outbox = emailOutbox(db.forWorkspace({ workspaceId: ids.a }));
    expect(await outbox.claim(id, first)).toBe(true);
    expect(await claimedBy(id)).toBe(first);
    await outbox.release(id);
    expect(await statusOf(id)).toEqual({ status: 'queued', failure: null });
    expect(await claimedBy(id)).toBeNull();
    expect(await outbox.claim(id, other)).toBe(true);
    expect(await claimedBy(id)).toBe(other);
  });

  it('leaves a row another job is still sending to that job, which then records it sent', async () => {
    const { first, other } = runs();
    const id = await insertRow(ids.a, `mid-send-${run}@example.test`);
    const outbox = emailOutbox(db.forWorkspace({ workspaceId: ids.a }));
    expect(await outbox.claim(id, first)).toBe(true); // the first job's run, now sending
    expect(await outbox.load(id, other)).toEqual({ skip: 'sending' }); // another job's run, at the same time
    expect(await statusOf(id)).toEqual({ status: 'sending', failure: null });
    expect(await outbox.sent(id, '<first-run@example.test>')).toBe(true); // the first run finishes
    expect(await statusOf(id)).toEqual({ status: 'sent', failure: null });
    expect(await providerIdOf(id)).toBe('<first-run@example.test>');
  });

  // Argus F1 on #197: a run that claimed the row and then lost the database (in sent(), release() or fail()) leaves it
  // `sending`. pg-boss retries that job only after the run has failed, so the retry knows the claim is a dead run's.
  it('marks a row its own job claimed interrupted when that job runs again, however recent the claim', async () => {
    const { first } = runs();
    const id = await insertRow(ids.a, `own-claim-${run}@example.test`);
    const outbox = emailOutbox(db.forWorkspace({ workspaceId: ids.a }));
    expect(await outbox.claim(id, first)).toBe(true); // the run whose database dropped after this
    expect(await outbox.load(id, first)).toEqual({ skip: 'interrupted' }); // its retry, seconds later
    expect(await statusOf(id)).toEqual({ status: 'failed', failure: INTERRUPTED });
    expect(await outbox.claim(id, first)).toBe(false);
  });

  it("counts another job's sending row as interrupted only once it is older than the job's expiry", async () => {
    const { first, other } = runs();
    const id = await insertRow(ids.a, `not-yet-${run}@example.test`);
    const outbox = emailOutbox(db.forWorkspace({ workspaceId: ids.a }));
    expect(await outbox.claim(id, first)).toBe(true);
    await age(id, SENDING_STALE_AFTER_SECONDS - 60); // its job could still be running
    expect(await outbox.load(id, other)).toEqual({ skip: 'sending' });
    expect((await statusOf(id)).status).toBe('sending');
  });

  it('never sends an interrupted row again, and says why', async () => {
    const { first, other } = runs();
    const id = await insertRow(ids.a, `interrupted-${run}@example.test`);
    const outbox = emailOutbox(db.forWorkspace({ workspaceId: ids.a }));
    expect(await outbox.claim(id, first)).toBe(true); // the run that was killed here
    await age(id, SENDING_STALE_AFTER_SECONDS + 1); // pg-boss retries a killed job only after it expires
    expect(await outbox.load(id, other)).toEqual({ skip: 'interrupted' });
    expect(await statusOf(id)).toEqual({ status: 'failed', failure: INTERRUPTED });
    expect(await outbox.claim(id, other)).toBe(false);
  });

  it('records the send of a run that outlived its job, though the row was marked interrupted', async () => {
    const { first } = runs();
    const id = await insertRow(ids.a, `outlived-${run}@example.test`);
    const outbox = emailOutbox(db.forWorkspace({ workspaceId: ids.a }));
    expect(await outbox.claim(id, first)).toBe(true); // a slow run, still sending
    await age(id, SENDING_STALE_AFTER_SECONDS + 1);
    expect(await outbox.load(id, first)).toEqual({ skip: 'interrupted' }); // its job's retry
    expect(await outbox.sent(id, '<slow-run@example.test>')).toBe(true); // the slow run's send went out
    expect(await statusOf(id)).toEqual({ status: 'sent', failure: null });
    expect(await providerIdOf(id)).toBe('<slow-run@example.test>');
  });

  it('records nothing for a row no run is sending', async () => {
    const id = await insertRow(ids.a, `not-sending-${run}@example.test`);
    const outbox = emailOutbox(db.forWorkspace({ workspaceId: ids.a }));
    expect(await outbox.sent(id, '<nobody@example.test>')).toBe(false);
    await outbox.fail(id, 'its template or data was refused');
    expect(await outbox.sent(id, '<nobody@example.test>')).toBe(false); // failed for another reason
    expect(await statusOf(id)).toEqual({
      status: 'failed',
      failure: 'its template or data was refused',
    });
  });

  it("finds nothing of another workspace's, and changes nothing of it", async () => {
    const { first } = runs();
    const outbox = emailOutbox(db.forWorkspace({ workspaceId: ids.a }));
    expect(await outbox.load(ids.rowB, first)).toEqual({ skip: 'missing' });
    expect(await outbox.claim(ids.rowB, first)).toBe(false);
    await outbox.fail(ids.rowB, 'should not land');
    expect(await outbox.sent(ids.rowB, '<should-not-land@example.test>')).toBe(false);
    expect(await statusOf(ids.rowB)).toEqual({ status: 'queued', failure: null });
    expect(await providerIdOf(ids.rowB)).toBeNull();
    expect(await claimedBy(ids.rowB)).toBeNull();
  });
});

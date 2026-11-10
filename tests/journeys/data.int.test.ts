// The Data feature's journey (§19 A task's life, #150): two workspaces' data stays apart through every layer.
// It is the feature's first task and lands marked `it.fails`: while the feature is unbuilt the test is expected to
// fail, so CI's `services` job stays green. The feature's last task (#105) removes the mark; the feature is done when
// this passes in CI.
//
// What exists is called as it is built: `@lzp/db` (#71: `db.forWorkspace(ctx).transaction((tx) => …)`, `migrate`),
// `@lzp/storage` (#73) and the config files (#69). What doesn't exist yet is loaded inside the test with `load()`, so
// this file loads, typechecks and lints before it does, and the test fails only because that piece (or a service) isn't
// there yet. It is marked `Assumed:` with the task that builds it, at the line that uses it. Each task of the feature may
// change those calls to its real API, but never weaken an assertion.
//
// Runs only in `pnpm check:services` and CI's `services` job (the `.int.test.ts` name; Postgres, the file store and
// Mailpit come from docker/compose.yml). The settings are config/env.ts's.
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.ts';
import { networks, networksConfigSchema, sizes } from '../../config/networks.ts';
import { extraPack, globalDailyAiCap, plans, plansConfigSchema } from '../../config/plans.ts';
import {
  createDb,
  member,
  migrate,
  user,
  workspace,
  type Db,
  type Scoped,
  type WorkspaceCtx,
} from '../../packages/db/src/index.ts';
import { assetKey, createStorage } from '../../packages/storage/src/index.ts';

// ---- Helpers ---------------------------------------------------------------------------------------------------

/** A result row: the columns by name. */
type Row = Record<string, string | boolean | undefined>;

/**
 * A query as text: each `${value}` becomes a quoted SQL literal. The root can't import drizzle's `sql` tag (it belongs
 * to packages/db) and the raw client is off limits outside it, so this is how the test's few raw statements, on tables
 * that have no Drizzle schema yet, carry a value. Every value is one this test made (an id, the run's uuid).
 */
function text(strings: TemplateStringsArray, ...values: string[]): string {
  let query = '';
  strings.forEach((part, i) => {
    query += part;
    const value = values[i];
    if (value !== undefined) query += `'${value.replaceAll("'", "''")}'`;
  });
  return query;
}

// ---- What the test assumes of the feature's modules, still to be built ----------------------------------------------

/** What a job handler gets: its payload and `db` already scoped to `payload.workspaceId` (#72). */
interface JobInput {
  payload: { workspaceId: string };
  db: Scoped;
}

/**
 * Assumed (#72): `@lzp/db` gives the job queue: pg-boss's `send`, on the app role's connection. Payloads hold ids only
 * (the `jobs` rules).
 */
interface QueueModule {
  createQueue: (appUrl: string) => Promise<{
    send: (queue: string, payload: object) => Promise<string | null>;
    stop: () => Promise<void>;
  }>;
}

/**
 * Assumed (#72): `apps/worker` starts the pg-boss worker with the job handlers (the `email` queue's among them) and lets
 * a test add one. `run` hands a job to its handler once, as pg-boss does on a retry or a redelivery.
 */
interface WorkerModule {
  startWorker: (options: {
    databaseUrl: string;
    handlers?: Record<string, (input: JobInput) => Promise<void>>;
  }) => Promise<{
    run: (queue: string, payload: object) => Promise<void>;
    stop: () => Promise<void>;
  }>;
}

/**
 * Loads a module of the feature when the test runs, so a module that doesn't exist yet can't break the file. The path
 * is relative to this file; it goes through a file URL because Vitest resolves a bare relative path in a variable
 * from the project's root, not from the file.
 */
async function load<T>(path: string): Promise<T> {
  const mod: unknown = await import(new URL(path, import.meta.url).href);
  return mod as T;
}

/** A promise that gives up with a clear message, so a job that never runs fails the test instead of hanging it. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${what}: nothing after ${String(ms)} ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A workspace and its Owner, made the way packages/db's rls.int.test.ts makes one ("in one unit of work, set to the id
 * the app made for it"): Better Auth's `user` (a global table the app role may insert into), the `workspace` and the
 * Owner's `member` row, in one transaction scoped to the new workspace's id.
 */
async function seedWorkspace(
  db: Db,
  label: string,
  run: string,
  ownerEmail: string,
): Promise<{ workspaceId: string; ownerUserId: string }> {
  const workspaceId = randomUUIDv7();
  const ownerUserId = await db.forWorkspace({ workspaceId }).transaction(async (tx) => {
    const [owner] = await tx
      .insert(user)
      .values({ name: `Owner ${label} ${run}`, email: ownerEmail })
      .returning({ id: user.id });
    if (owner === undefined) throw new Error('no Owner was made');
    await tx.insert(workspace).values({
      id: workspaceId,
      name: `Journey ${label} ${run}`,
      slug: `journey-${label}-${run}`,
    });
    await tx.insert(member).values({ workspaceId, userId: owner.id, role: 'owner' });
    return owner.id;
  });
  return { workspaceId, ownerUserId };
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface MailpitSearch {
  total: number;
}

describe('the Data feature: two workspaces stay apart through every layer', () => {
  it(
    'keeps A and B apart in the database, jobs, email, files and config',
    { timeout: 90_000 },
    async () => {
      const env = { ...loadEnv('migrate'), ...loadEnv('worker') };
      const run = randomUUID();
      const cleanups: (() => Promise<void>)[] = [];

      try {
        // 1. Migrations run as the owner role; the app connects as the app role, which can't bypass row-level security.
        await migrate(env.DATABASE_OWNER_URL);
        await migrate(env.DATABASE_OWNER_URL); // running them again changes nothing and doesn't fail

        const db = createDb(env.DATABASE_URL);
        cleanups.push(() => db.close());
        /** One unit of work in `ctx`'s workspace: a query, run as the app role with the workspace set first. */
        const asApp =
          (ctx: WorkspaceCtx) =>
          (strings: TemplateStringsArray, ...values: string[]): Promise<Row[]> =>
            db
              .forWorkspace(ctx)
              .transaction(async (tx) => (await tx.execute<Row>(text(strings, ...values))).rows);

        // 2. Workspaces A and B exist, each with an Owner.
        const emailA = `owner-a-${run}@journey.invalid`;
        const emailB = `owner-b-${run}@journey.invalid`;
        const a = await seedWorkspace(db, 'a', run, emailA);
        const b = await seedWorkspace(db, 'b', run, emailB);
        const ctxA = { workspaceId: a.workspaceId };
        const ctxB = { workspaceId: b.workspaceId };
        const asA = asApp(ctxA);
        const asB = asApp(ctxB);
        cleanups.push(async () => {
          // Deleting a workspace removes its members (and, once they exist, its rows) with it; the people are global.
          await asA`delete from workspace where id = ${a.workspaceId}`;
          await asB`delete from workspace where id = ${b.workspaceId}`;
          await asA`delete from "user" where id in (${a.ownerUserId}, ${b.ownerUserId})`;
        });
        expect(a.workspaceId).toMatch(UUID_V7);
        expect(b.workspaceId).toMatch(UUID_V7);
        expect(a.workspaceId).not.toBe(b.workspaceId);
        expect(a.ownerUserId).not.toBe(b.ownerUserId);

        // The app logs in as the app role: not a superuser, no BYPASSRLS, can't create tables ...
        const role = await asA`select current_user as who, rolbypassrls or rolsuper as bypass
             from pg_roles where rolname = current_user`;
        expect(role).toEqual([{ who: 'lzp_app', bypass: false }]);
        await expect(asA`create table journey_probe (i int)`).rejects.toThrow();
        // ... the tables belong to the owner, and row-level security is on for workspace data.
        const tables = await asA`select t.tablename, t.tableowner, c.relrowsecurity as rls
             from pg_tables t join pg_class c on c.relname = t.tablename
            where t.schemaname = 'public' and t.tablename in ('brand', 'email_message')
            order by t.tablename`;
        const found = tables.map((row) => row.tablename);
        // Assumed (#72): the `email_message` outbox table, built with the email job.
        expect(
          found,
          'Assumed (#72): the `email_message` outbox table does not exist yet',
        ).toContain('email_message');
        // Assumed: the `brand` table. No task builds it yet; Athena names it.
        expect(
          found,
          'Assumed: the `brand` table does not exist yet (no task builds it)',
        ).toContain('brand');
        expect(tables).toEqual([
          { tablename: 'brand', tableowner: 'lzp_owner', rls: true },
          { tablename: 'email_message', tableowner: 'lzp_owner', rls: true },
        ]);

        // 3. In A's context a row is written; a job queued for A runs in the worker and sees A's row and none of B's.
        // Assumed: `brand` has `workspace_id` and `name_en`; the other columns have defaults.
        const nameA = `Brand A ${run}`;
        const nameB = `Brand B ${run}`;
        await asA`insert into brand (workspace_id, name_en) values (${a.workspaceId}, ${nameA})`;
        await asB`insert into brand (workspace_id, name_en) values (${b.workspaceId}, ${nameB})`;
        // The second wall on its own: A's context can't write a row for B (the policy's check), and a query with no
        // workspace filter at all still sees only A's rows.
        const planted = `Planted by A ${run}`;
        await expect(
          asA`insert into brand (workspace_id, name_en) values (${b.workspaceId}, ${planted})`,
        ).rejects.toThrow();
        const unfiltered = await asA`select workspace_id, name_en from brand`;
        expect(unfiltered.map((row) => row.name_en)).toContain(nameA);
        expect(unfiltered.map((row) => row.name_en)).not.toContain(nameB);
        expect(unfiltered.every((row) => row.workspace_id === a.workspaceId)).toBe(true);
        const seenByB = await asB`select name_en from brand`;
        expect(seenByB.map((row) => row.name_en)).toContain(nameB);
        expect(seenByB.map((row) => row.name_en)).not.toContain(planted);

        const seenInJob = Promise.withResolvers<{ payload: object; rows: Row[] }>();
        // Assumed (#72): `apps/worker` starts the worker and runs a handler a test registers like any other job, with
        // `db` scoped to the payload's workspace.
        const workerModule = await load<WorkerModule>('../../apps/worker/src/index.ts');
        const worker = await workerModule.startWorker({
          databaseUrl: env.DATABASE_URL,
          handlers: {
            'journey-probe': async ({ payload, db: scoped }) => {
              const rows = await scoped.transaction(
                async (tx) =>
                  (await tx.execute<Row>('select workspace_id, name_en from brand')).rows,
              );
              seenInJob.resolve({ payload, rows });
            },
          },
        });
        cleanups.push(() => worker.stop());
        // Assumed (#72): `@lzp/db` gives `createQueue`.
        const queueModule = await load<QueueModule>('../../packages/db/src/index.ts');
        const queue = await queueModule.createQueue(env.DATABASE_URL);
        cleanups.push(() => queue.stop());
        await queue.send('journey-probe', { workspaceId: a.workspaceId });
        const job = await within(seenInJob.promise, 30_000, 'the job queued for A');
        expect(job.payload).toEqual({ workspaceId: a.workspaceId }); // ids only, never content
        const jobRows = job.rows;
        expect(jobRows.map((row) => row.name_en)).toContain(nameA);
        expect(jobRows.map((row) => row.name_en)).not.toContain(nameB);
        expect(jobRows.every((row) => row.workspace_id === a.workspaceId)).toBe(true);

        // 4. The email job for an A member, run twice for the same outbox row, puts exactly one message in Mailpit.
        // Assumed (#72): `email_message` has `workspace_id`, `template`, `to_address` and `status`, and the job sets
        // `status` to 'sent'; the `email` queue's payload is the workspace and the outbox row's ids.
        const outbox =
          await asA`insert into email_message (workspace_id, template, to_address, status)
           values (${a.workspaceId}, 'email-check', ${emailA}, 'queued') returning id`;
        const emailMessageId = String(outbox[0]?.id);
        expect(emailMessageId).toMatch(UUID_V7);
        const payload = { workspaceId: a.workspaceId, emailMessageId };
        await worker.run('email', payload);
        await worker.run('email', payload);
        // Assumed: Mailpit's API is on port 8025 of the SMTP host (docker/compose.yml), as in the `services` job's smoke check.
        const mailpit = `http://${URL.parse(env.SMTP_URL)?.hostname ?? '127.0.0.1'}:${process.env['LZP_MAILPIT_PORT'] ?? '8025'}`;
        const messages = await fetch(
          `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${emailA}`)}`,
        );
        expect(messages.ok).toBe(true);
        expect(((await messages.json()) as MailpitSearch).total).toBe(1);
        const sent = await asA`select status from email_message where id = ${emailMessageId}`;
        expect(sent).toEqual([{ status: 'sent' }]);
        const outboxSeenByB = await asB`select id from email_message where id = ${emailMessageId}`;
        expect(outboxSeenByB).toEqual([]);

        // 5. A file uploaded through a signed link lands under ws/<A's id>/ and reads back through a signed download
        // link. Signing one of B's keys from A's context is refused. An unsigned read is refused.
        // (#73: only an asset's original goes through a signed upload, so that is the key used.)
        const storage = createStorage(env);
        cleanups.push(() => {
          storage.close();
          return Promise.resolve();
        });
        const body = Buffer.from(`journey ${run} বাংলা`);
        const limits = { maxBytes: 1024, contentTypes: ['text/plain'] };
        const upload = { contentType: 'text/plain', size: body.length };
        const keyOf = (ctx: WorkspaceCtx) =>
          assetKey(ctx, { brandId: randomUUIDv7(), assetId: randomUUIDv7(), variant: 'original' });
        const keyA = keyOf(ctxA);
        const keyB = keyOf(ctxB);

        const signedUpload = await storage.signUpload(ctxA, keyA, upload, limits);
        expect(signedUpload.url).toContain(`/${env.STORAGE_BUCKET}/ws/${a.workspaceId}/`);
        const put = await fetch(signedUpload.url, {
          method: 'PUT',
          headers: signedUpload.headers,
          body,
        });
        expect(put.ok).toBe(true);

        const download = (await storage.signDownload(ctxA, keyA)).url;
        const read = await fetch(download);
        expect(read.status).toBe(200);
        expect(Buffer.from(await read.arrayBuffer()).equals(body)).toBe(true);

        await expect(storage.signDownload(ctxA, keyB)).rejects.toThrow();
        await expect(storage.signUpload(ctxA, keyB, upload, limits)).rejects.toThrow();
        // Without the signature the file store says no ...
        const unsigned = new URL(download);
        unsigned.search = '';
        expect((await fetch(unsigned)).status).toBe(403);
        // ... and A's signature doesn't open B's key.
        const swapped = new URL(download);
        swapped.pathname = swapped.pathname.replace(a.workspaceId, b.workspaceId);
        expect((await fetch(swapped)).status).toBe(403);

        // 6. The plans and networks config load through their schemas (#69).
        expect(Object.keys(plans).length).toBeGreaterThan(0);
        expect(() => plansConfigSchema.parse({ plans, extraPack, globalDailyAiCap })).not.toThrow();
        expect(plansConfigSchema.safeParse(null).success).toBe(false);
        expect(Object.keys(networks).length).toBeGreaterThan(0);
        expect(() => networksConfigSchema.parse({ sizes, networks })).not.toThrow();
        expect(networksConfigSchema.safeParse(null).success).toBe(false);
      } finally {
        for (const cleanup of cleanups.reverse()) await cleanup();
      }
    },
  );
});

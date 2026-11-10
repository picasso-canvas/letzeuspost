// The Data feature's journey (§19 A task's life, #150): two workspaces' data stays apart through every layer.
// It is the feature's first task and lands marked `it.fails`: while the feature is unbuilt the test is expected to
// fail, so CI's `services` job stays green. The feature's last task (#105) removes the mark; the feature is done when
// this passes in CI.
//
// The feature's modules are loaded inside the test with `load()`, so this file loads, typechecks and lints before
// they exist, and fails only because they (or the services) aren't there yet. Each task of the feature may change the
// calls below to its real API, but never weaken an assertion. Where the Data tasks' Done-when fix a name it is used
// as written (`db.forWorkspace(ctx)`, `ws/<workspace id>/` keys, signed links, the email job, `config/plans.ts` and
// `config/networks.ts`); every other name is an ASSUMPTION, marked `Assumed:`.
//
// Runs only in `pnpm check:services` and CI's `services` job (the `.int.test.ts` name; Postgres, the file store and
// Mailpit come from docker/compose.yml). The settings are config/env.ts's.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.ts';

// ---- What the test assumes of the feature's modules ------------------------------------------------------------

/** The workspace (and, where there is one, the person) a call acts for: what `db.forWorkspace(ctx)` takes (#71). */
interface Ctx {
  readonly workspaceId: string;
}

/** A result row: the columns by name. */
type Row = Record<string, string | boolean | undefined>;

/** Assumed: the handle `db.forWorkspace(ctx)` returns runs SQL as the app role inside a transaction that has set the workspace first. */
interface Scoped {
  execute: (sql: string, params?: readonly unknown[]) => Promise<{ readonly rows: Row[] }>;
}

interface Db {
  forWorkspace: (ctx: Ctx) => Scoped;
  close: () => Promise<void>;
}

/** Assumed: `@lzp/db` runs the migrations as the owner role, seeds a workspace with its Owner, and connects as the app role. */
interface DbModule {
  migrate: (ownerUrl: string) => Promise<void>;
  seedWorkspace: (
    ownerUrl: string,
    input: { name: string; ownerEmail: string },
  ) => Promise<{ workspaceId: string; ownerUserId: string }>;
  createDb: (appUrl: string) => Db;
  /** pg-boss's `send`, on the app role's connection. Payloads hold ids only (the `jobs` rules). */
  createQueue: (appUrl: string) => Promise<{
    send: (queue: string, payload: object) => Promise<string | null>;
    stop: () => Promise<void>;
  }>;
}

/** What a job handler gets: its payload and `db` already scoped to `payload.workspaceId` (#72). */
interface JobInput {
  payload: { workspaceId: string };
  db: Scoped;
}

/**
 * Assumed: `apps/worker` starts the pg-boss worker with the job handlers (the `email` queue's among them) and lets a
 * test add one. `run` hands a job to its handler once, as pg-boss does on a retry or a redelivery.
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

/** Assumed: `@lzp/storage` signs links for a key under the caller's own workspace, and refuses any other (#73). */
interface StorageModule {
  createStorage: (settings: Record<string, string>) => {
    signUpload: (
      ctx: Ctx,
      key: string,
      limits: { contentType: string; maxBytes: number },
    ) => Promise<{ url: string; headers: Record<string, string> }>;
    signDownload: (ctx: Ctx, key: string) => Promise<string>;
  };
}

/** Assumed: each config file exports its data and a zod schema of it (#69). */
interface ConfigModule {
  plans: object;
  plansSchema: {
    parse: (value: unknown) => unknown;
    safeParse: (value: unknown) => { success: boolean };
  };
  networks: object;
  networksSchema: {
    parse: (value: unknown) => unknown;
    safeParse: (value: unknown) => { success: boolean };
  };
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

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface MailpitSearch {
  total: number;
}

describe('the Data feature: two workspaces stay apart through every layer', () => {
  it.fails(
    'keeps A and B apart in the database, jobs, email, files and config',
    { timeout: 90_000 },
    async () => {
      const env = { ...loadEnv('migrate'), ...loadEnv('worker') };
      const run = randomUUID();
      const cleanups: (() => Promise<void>)[] = [];

      try {
        // 1. Migrations run as the owner role; the app connects as the app role, which can't bypass row-level security.
        const dbModule = await load<DbModule>('../../packages/db/src/index.ts');
        await dbModule.migrate(env.DATABASE_OWNER_URL);
        await dbModule.migrate(env.DATABASE_OWNER_URL); // running them again changes nothing and doesn't fail

        const db = dbModule.createDb(env.DATABASE_URL);
        cleanups.push(() => db.close());

        // 2. Workspaces A and B exist, each with an Owner.
        const emailA = `owner-a-${run}@journey.invalid`;
        const emailB = `owner-b-${run}@journey.invalid`;
        const a = await dbModule.seedWorkspace(env.DATABASE_OWNER_URL, {
          name: `Journey A ${run}`,
          ownerEmail: emailA,
        });
        const b = await dbModule.seedWorkspace(env.DATABASE_OWNER_URL, {
          name: `Journey B ${run}`,
          ownerEmail: emailB,
        });
        expect(a.workspaceId).toMatch(UUID_V7);
        expect(b.workspaceId).toMatch(UUID_V7);
        expect(a.workspaceId).not.toBe(b.workspaceId);
        expect(a.ownerUserId).not.toBe(b.ownerUserId);
        const ctxA = { workspaceId: a.workspaceId };
        const ctxB = { workspaceId: b.workspaceId };

        const asAppA = db.forWorkspace(ctxA);
        // The app logs in as the app role: not a superuser, no BYPASSRLS, can't create tables ...
        const role = await asAppA.execute(
          `select current_user as who, rolbypassrls or rolsuper as bypass
             from pg_roles where rolname = current_user`,
        );
        expect(role.rows).toEqual([{ who: 'lzp_app', bypass: false }]);
        await expect(asAppA.execute('create table journey_probe (i int)')).rejects.toThrow();
        // ... the tables belong to the owner, and row-level security is on for workspace data.
        const tables = await asAppA.execute(
          `select t.tablename, t.tableowner, c.relrowsecurity as rls
             from pg_tables t join pg_class c on c.relname = t.tablename
            where t.schemaname = 'public' and t.tablename in ('brand', 'email_message')
            order by t.tablename`,
        );
        expect(tables.rows).toEqual([
          { tablename: 'brand', tableowner: 'lzp_owner', rls: true },
          { tablename: 'email_message', tableowner: 'lzp_owner', rls: true },
        ]);

        // 3. In A's context a row is written; a job queued for A runs in the worker and sees A's row and none of B's.
        // Assumed: `brand` has `workspace_id` and `name_en`; the other columns have defaults.
        const nameA = `Brand A ${run}`;
        const nameB = `Brand B ${run}`;
        await asAppA.execute('insert into brand (workspace_id, name_en) values ($1, $2)', [
          a.workspaceId,
          nameA,
        ]);
        await db
          .forWorkspace(ctxB)
          .execute('insert into brand (workspace_id, name_en) values ($1, $2)', [
            b.workspaceId,
            nameB,
          ]);
        // The second wall on its own: A's context can't write a row for B (the policy's check), and a query with no
        // workspace filter at all still sees only A's rows.
        await expect(
          asAppA.execute('insert into brand (workspace_id, name_en) values ($1, $2)', [
            b.workspaceId,
            `Planted by A ${run}`,
          ]),
        ).rejects.toThrow();
        const unfiltered = await asAppA.execute('select workspace_id, name_en from brand');
        expect(unfiltered.rows.map((row) => row.name_en)).toContain(nameA);
        expect(unfiltered.rows.map((row) => row.name_en)).not.toContain(nameB);
        expect(unfiltered.rows.every((row) => row.workspace_id === a.workspaceId)).toBe(true);
        const seenByB = await db.forWorkspace(ctxB).execute('select name_en from brand');
        expect(seenByB.rows.map((row) => row.name_en)).toContain(nameB);
        expect(seenByB.rows.map((row) => row.name_en)).not.toContain(`Planted by A ${run}`);

        const seenInJob = Promise.withResolvers<{ payload: object; rows: Row[] }>();
        const workerModule = await load<WorkerModule>('../../apps/worker/src/index.ts');
        const worker = await workerModule.startWorker({
          databaseUrl: env.DATABASE_URL,
          handlers: {
            // Assumed: a handler registered by a test runs like any other job, with `db` scoped to the payload's workspace.
            'journey-probe': async ({ payload, db: scoped }) => {
              const { rows } = await scoped.execute('select workspace_id, name_en from brand');
              seenInJob.resolve({ payload, rows });
            },
          },
        });
        cleanups.push(() => worker.stop());
        const queue = await dbModule.createQueue(env.DATABASE_URL);
        cleanups.push(() => queue.stop());
        await queue.send('journey-probe', { workspaceId: a.workspaceId });
        const job = await within(seenInJob.promise, 30_000, 'the job queued for A');
        expect(job.payload).toEqual({ workspaceId: a.workspaceId }); // ids only, never content
        const jobRows = job.rows;
        expect(jobRows.map((row) => row.name_en)).toContain(nameA);
        expect(jobRows.map((row) => row.name_en)).not.toContain(nameB);
        expect(jobRows.every((row) => row.workspace_id === a.workspaceId)).toBe(true);

        // 4. The email job for an A member, run twice for the same outbox row, puts exactly one message in Mailpit.
        // Assumed: `email_message` has `workspace_id`, `template`, `to_address` and `status`, and the job sets `status`
        // to 'sent'; the `email` queue's payload is the workspace and the outbox row's ids.
        const outbox = await asAppA.execute(
          `insert into email_message (workspace_id, template, to_address, status)
           values ($1, 'email-check', $2, 'queued') returning id`,
          [a.workspaceId, emailA],
        );
        const emailMessageId = String(outbox.rows[0]?.id);
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
        const sent = await asAppA.execute('select status from email_message where id = $1', [
          emailMessageId,
        ]);
        expect(sent.rows).toEqual([{ status: 'sent' }]);
        const outboxSeenByB = await db
          .forWorkspace(ctxB)
          .execute('select id from email_message where id = $1', [emailMessageId]);
        expect(outboxSeenByB.rows).toEqual([]);

        // 5. A file uploaded through a signed link lands under ws/<A's id>/ and reads back through a signed download
        // link. Signing one of B's keys from A's context is refused. An unsigned read is refused.
        const storageModule = await load<StorageModule>('../../packages/storage/src/index.ts');
        const storage = storageModule.createStorage(env);
        const body = `journey ${run} বাংলা`;
        const keyA = `ws/${a.workspaceId}/journey/${run}.txt`;
        const keyB = `ws/${b.workspaceId}/journey/${run}.txt`;

        const upload = await storage.signUpload(ctxA, keyA, {
          contentType: 'text/plain',
          maxBytes: 1024,
        });
        expect(upload.url).toContain(`/${env.STORAGE_BUCKET}/ws/${a.workspaceId}/`);
        const put = await fetch(upload.url, {
          method: 'PUT',
          headers: upload.headers,
          body,
        });
        expect(put.ok).toBe(true);

        const download = await storage.signDownload(ctxA, keyA);
        const read = await fetch(download);
        expect(read.status).toBe(200);
        expect(await read.text()).toBe(body);

        await expect(storage.signDownload(ctxA, keyB)).rejects.toThrow();
        await expect(
          storage.signUpload(ctxA, keyB, { contentType: 'text/plain', maxBytes: 1024 }),
        ).rejects.toThrow();
        // Without the signature the file store says no ...
        const unsigned = new URL(download);
        unsigned.search = '';
        expect((await fetch(unsigned)).status).toBe(403);
        // ... and A's signature doesn't open B's key.
        const swapped = new URL(download);
        swapped.pathname = swapped.pathname.replace(a.workspaceId, b.workspaceId);
        expect((await fetch(swapped)).status).toBe(403);

        // 6. The plans and networks config load through their schemas.
        const plansModule =
          await load<Pick<ConfigModule, 'plans' | 'plansSchema'>>('../../config/plans.ts');
        const networksModule = await load<Pick<ConfigModule, 'networks' | 'networksSchema'>>(
          '../../config/networks.ts',
        );
        expect(Object.keys(plansModule.plans).length).toBeGreaterThan(0);
        expect(() => plansModule.plansSchema.parse(plansModule.plans)).not.toThrow();
        expect(plansModule.plansSchema.safeParse(null).success).toBe(false);
        expect(Object.keys(networksModule.networks).length).toBeGreaterThan(0);
        expect(() => networksModule.networksSchema.parse(networksModule.networks)).not.toThrow();
        expect(networksModule.networksSchema.safeParse(null).success).toBe(false);
      } finally {
        for (const cleanup of cleanups.reverse()) await cleanup();
      }
    },
  );
});

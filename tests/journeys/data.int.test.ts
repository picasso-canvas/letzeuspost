// The Data feature's journey (§19 A task's life, #150): two workspaces' data stays apart through every layer.
// It is the feature's first task and lands marked `it.fails`: while the feature is unbuilt the test is expected to
// fail, so CI's `services` job stays green. The feature's last task (#105) removes the mark; the feature is done when
// this passes in CI.
//
// What exists is called as it is built: `@lzp/db` (#71: `db.forWorkspace(ctx).transaction((tx) => …)`, `migrate`, the
// `invitation` table the journey proves isolation on), `@lzp/storage` (#73) and the config files (#69). What doesn't
// exist yet is loaded inside the test with `assumed()`, so this file loads, typechecks and lints before it does, and the
// test fails only because that piece (or a service) isn't there yet, with a message that names its task. It is marked
// `Assumed:` with the task that builds it, at the line that uses it. Each task of the feature may change those calls to
// its real API, but never weaken an assertion.
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
  invitation,
  member,
  migrate,
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
 * A query as text: each `${value}` becomes a quoted SQL literal. Everything with a Drizzle schema in `@lzp/db` goes
 * through the typed `tx.insert` and `tx.select`. This is for the rest: catalog queries, the `email_message` outbox
 * (no schema until #72), Better Auth's `user` table (only `@lzp/db/auth` exports it, #176, and only packages/auth may
 * import that) and the clean-up deletes (the root can't import drizzle's `eq`, which belongs to packages/db). Every
 * value is one this test made (an id, the run's uuid).
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
type CreateQueue = (appUrl: string) => Promise<{
  send: (queue: string, payload: object) => Promise<string | null>;
  stop: () => Promise<void>;
}>;

/**
 * Assumed (#72): `apps/worker` starts the pg-boss worker with the job handlers (the `email` queue's among them) and lets
 * a test add one. `run` hands a job to its handler once, as pg-boss does on a retry or a redelivery.
 */
type StartWorker = (options: {
  databaseUrl: string;
  handlers?: Record<string, (input: JobInput) => Promise<void>>;
}) => Promise<{
  run: (queue: string, payload: object) => Promise<void>;
  stop: () => Promise<void>;
}>;

/**
 * Loads one export of a module of the feature when the test runs, so a module that doesn't exist yet can't break the
 * file, and says which task builds it when it isn't there. The path is relative to this file; it goes through a file
 * URL because Vitest resolves a bare relative path in a variable from the project's root, not from the file.
 */
async function assumed<T>(path: string, name: string, task: string): Promise<T> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(new URL(path, import.meta.url).href)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Assumed (${task}): ${path} can't be loaded yet: ${String(error)}`, {
      cause: error,
    });
  }
  const value = mod[name];
  if (value === undefined) throw new Error(`Assumed (${task}): ${path} has no \`${name}\` yet`);
  return value as T;
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
 * A workspace and its Owner, made the way packages/db's rls.int.test.ts makes them: by the owner role (the tables'
 * owner, which row-level security doesn't apply to), because the app role can't insert a person (#176). The person is
 * Better Auth's `user` row, then the `workspace` and the Owner's `member` row, in one transaction.
 */
async function seedWorkspace(
  owner: Db,
  label: string,
  run: string,
  ownerEmail: string,
): Promise<{ workspaceId: string; ownerUserId: string }> {
  const workspaceId = randomUUIDv7();
  const ownerUserId = await owner.forWorkspace({ workspaceId }).transaction(async (tx) => {
    const { rows } = await tx.execute<Row>(
      text`insert into "user" (name, email) values (${`Owner ${label} ${run}`}, ${ownerEmail}) returning id`,
    );
    const ownerId = String(rows[0]?.id);
    await tx.insert(workspace).values({
      id: workspaceId,
      name: `Journey ${label} ${run}`,
      slug: `journey-${label}-${run}`,
    });
    await tx.insert(member).values({ workspaceId, userId: ownerId, role: 'owner' });
    return ownerId;
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
        const ownerDb = createDb(env.DATABASE_OWNER_URL);
        cleanups.push(() => ownerDb.close());
        /** One unit of work in `ctx`'s workspace: a query, run as `handle`'s role with the workspace set first. */
        const through =
          (handle: Db) =>
          (ctx: WorkspaceCtx) =>
          (strings: TemplateStringsArray, ...values: string[]): Promise<Row[]> =>
            handle
              .forWorkspace(ctx)
              .transaction(async (tx) => (await tx.execute<Row>(text(strings, ...values))).rows);
        const asApp = through(db);
        const asOwner = through(ownerDb);

        // 2. Workspaces A and B exist, each with an Owner (made by the owner role, as rls.int.test.ts does).
        const emailA = `owner-a-${run}@journey.invalid`;
        const emailB = `owner-b-${run}@journey.invalid`;
        const a = await seedWorkspace(ownerDb, 'a', run, emailA);
        const b = await seedWorkspace(ownerDb, 'b', run, emailB);
        const ctxA = { workspaceId: a.workspaceId };
        const ctxB = { workspaceId: b.workspaceId };
        const asA = asApp(ctxA);
        const asB = asApp(ctxB);
        cleanups.push(async () => {
          // Deleting a workspace removes its members and invitations with it; the people are global. The owner role does
          // it: the app role can't delete a person.
          await asOwner(ctxA)`delete from workspace where id = ${a.workspaceId}`;
          await asOwner(ctxB)`delete from workspace where id = ${b.workspaceId}`;
          await asOwner(ctxA)`delete from "user" where id in (${a.ownerUserId}, ${b.ownerUserId})`;
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
            where t.schemaname = 'public' and t.tablename = 'invitation'`;
        expect(tables).toEqual([{ tablename: 'invitation', tableowner: 'lzp_owner', rls: true }]);

        // 3. In A's context a row is written; a job queued for A runs in the worker and sees A's row and none of B's.
        // `invitation` is #71's workspace table with row-level security; its inviter is each workspace's Owner.
        const inviteA = `invited-a-${run}@journey.invalid`;
        const inviteB = `invited-b-${run}@journey.invalid`;
        const invite = (ctx: WorkspaceCtx, inviterId: string, email: string) =>
          db.forWorkspace(ctx).transaction((tx) =>
            tx.insert(invitation).values({
              workspaceId: ctx.workspaceId,
              email,
              role: 'editor',
              expiresAt: new Date(Date.now() + 7 * 86_400_000),
              inviterId,
            }),
          );
        await invite(ctxA, a.ownerUserId, inviteA);
        await invite(ctxB, b.ownerUserId, inviteB);
        // The second wall on its own: A's context can't write a row for B (the policy's check), and a query with no
        // workspace filter at all still sees only A's rows.
        const planted = `planted-by-a-${run}@journey.invalid`;
        await expect(
          db.forWorkspace(ctxA).transaction((tx) =>
            tx.insert(invitation).values({
              workspaceId: b.workspaceId,
              email: planted,
              role: 'admin',
              expiresAt: new Date(Date.now() + 86_400_000),
              inviterId: a.ownerUserId,
            }),
          ),
        ).rejects.toThrow();
        const invitationsOf = (ctx: WorkspaceCtx) =>
          db
            .forWorkspace(ctx)
            .transaction((tx) =>
              tx
                .select({ workspaceId: invitation.workspaceId, email: invitation.email })
                .from(invitation),
            );
        const unfiltered = await invitationsOf(ctxA);
        expect(unfiltered.map((row) => row.email)).toContain(inviteA);
        expect(unfiltered.map((row) => row.email)).not.toContain(inviteB);
        expect(unfiltered.every((row) => row.workspaceId === a.workspaceId)).toBe(true);
        const seenByB = await invitationsOf(ctxB);
        expect(seenByB.map((row) => row.email)).toEqual([inviteB]);

        const seenInJob = Promise.withResolvers<{
          payload: object;
          rows: { workspaceId: string; email: string }[];
        }>();
        // Assumed (#72): `apps/worker` starts the worker and runs a handler a test registers like any other job, with
        // `db` scoped to the payload's workspace.
        const startWorker = await assumed<StartWorker>(
          '../../apps/worker/src/index.ts',
          'startWorker',
          '#72',
        );
        const worker = await startWorker({
          databaseUrl: env.DATABASE_URL,
          handlers: {
            'journey-probe': async ({ payload, db: scoped }) => {
              const rows = await scoped.transaction((tx) =>
                tx
                  .select({ workspaceId: invitation.workspaceId, email: invitation.email })
                  .from(invitation),
              );
              seenInJob.resolve({ payload, rows });
            },
          },
        });
        cleanups.push(() => worker.stop());
        // Assumed (#72): `@lzp/db` gives `createQueue`.
        const createQueue = await assumed<CreateQueue>(
          '../../packages/db/src/index.ts',
          'createQueue',
          '#72',
        );
        const queue = await createQueue(env.DATABASE_URL);
        cleanups.push(() => queue.stop());
        await queue.send('journey-probe', { workspaceId: a.workspaceId });
        const job = await within(seenInJob.promise, 30_000, 'the job queued for A');
        expect(job.payload).toEqual({ workspaceId: a.workspaceId }); // ids only, never content
        expect(job.rows.map((row) => row.email)).toContain(inviteA);
        expect(job.rows.map((row) => row.email)).not.toContain(inviteB);
        expect(job.rows.every((row) => row.workspaceId === a.workspaceId)).toBe(true);

        // 4. The email job for an A member, run twice for the same outbox row, puts exactly one message in Mailpit.
        // Assumed (#72): `email_message` has `workspace_id`, `template`, `to_address` and `status`, and the job sets
        // `status` to 'sent'; the `email` queue's payload is the workspace and the outbox row's ids.
        const outboxTable = await asA`select t.tablename, t.tableowner, c.relrowsecurity as rls
             from pg_tables t join pg_class c on c.relname = t.tablename
            where t.schemaname = 'public' and t.tablename = 'email_message'`;
        expect(
          outboxTable,
          'Assumed (#72): the `email_message` outbox table does not exist yet',
        ).toEqual([{ tablename: 'email_message', tableowner: 'lzp_owner', rls: true }]);
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

// The job queues and the worker's handlers, given workspace B's ids in a job of workspace A's (§13 Keeping workspaces
// apart, Jobs): refused, or run in A, where B's rows aren't there to read or change.
//
// The queues: a job is handed to its handler only through `payloadOf` (packages/db's jobs/boss.ts), which refuses a
// payload with anything but the queue's ids and a job whose group isn't its payload's workspace, and the handler's
// one database handle is `forWorkspace` on that workspace. The handlers: the worker's `email`, `account-email` and
// `asset` handlers (apps/worker), run here directly with the job context `createJobs` gives them, not through a queue:
// every queue already has a services file working it (packages/db's jobs.int.test.ts, the Data journey, apps/worker's),
// and a handler of this file's on a shared queue would take, and complete, their jobs (Argus F1 on #202). The transport,
// the renderer and the file store are stand-ins that record what they're asked: a handler that read B's row would ask
// them to send it, or to read or write B's file.
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.ts';
import { createAccountEmails } from '../../packages/auth/src/index.ts';
import {
  asset,
  checkPayload,
  emailMessage,
  invitation,
  queueNames,
  type Payload,
  type QueueName,
  type Scoped,
  type WorkspaceCtx,
} from '../../packages/db/src/index.ts';
import { picture } from '../../apps/worker/src/asset-fixtures.ts';
import { payloadOf } from '../../packages/db/src/jobs/boss.ts';
import { workspaceOf } from '../../packages/db/src/jobs/queues.ts';
import { setUpTenancy, text, type Row, type Tenancy } from './fixtures.ts';
import { tenancy } from './tenancy.ts';

let t: Tenancy;

beforeAll(async () => {
  t = await setUpTenancy('jobs');
}, 60_000);

afterAll(async () => {
  await t.close();
});

/** A payload for `queue` in A's workspace, every other id in it B's (or one B could have made). */
function payloadInAWithBIds(queue: QueueName): object {
  const workspaceId = t.a.ctx.workspaceId;
  const b = () => randomUUIDv7();
  switch (queue) {
    case 'ai':
      return { workspaceId, batchId: b(), postId: b() };
    case 'asset':
      return { workspaceId, brandId: t.b.brand.id, assetId: t.b.asset.id };
    case 'render':
      return { workspaceId, postId: b(), postVersionId: b() };
    case 'fetch':
      return { workspaceId, brandId: b(), batchId: b() };
    case 'export':
      return { workspaceId, exportId: b() };
    case 'email':
      return { workspaceId, emailMessageId: t.b.email.id };
    case 'account-email':
      return { accountEmailId: t.b.email.id };
  }
}

/** B's rows, read and changed by id in a workspace's unit of work: what a handler's `db` can reach of B's. */
async function reachOfB(db: Scoped) {
  const { b } = t;
  return db.transaction(async (tx) => {
    const read = await tx.execute<Row>(
      text`select id from invitation where id = ${b.invitation.id}
       union all select id from email_message where id = ${b.email.id}
       union all select id from workspace where id = ${b.ctx.workspaceId}
       union all select workspace_id from member where workspace_id = ${b.ctx.workspaceId}
       union all select id from brand where id = ${b.brand.id}
       union all select id from asset where id = ${b.asset.id}`,
    );
    const changed = await tx.execute(
      text`update email_message set status = 'failed', failure = 'tenancy' where id = ${b.email.id}`,
    );
    // What an asset job does to its row (#400): fill it in and mark it ready.
    const processed = await tx.execute(
      text`update asset set status = 'ready', consent = true, description = 'tenancy' where id = ${b.asset.id}`,
    );
    const removed = await tx.execute(text`delete from invitation where id = ${b.invitation.id}`);
    const removedAsset = await tx.execute(text`delete from asset where id = ${b.asset.id}`);
    return {
      read: read.rows,
      changed: changed.rowCount,
      processed: processed.rowCount,
      removed: removed.rowCount,
      removedAsset: removedAsset.rowCount,
    };
  });
}

/** B's rows as B sees them: still there, the outbox row still queued, the asset still waiting. */
async function expectBUntouched() {
  const rows = await t.app.forWorkspace(t.b.ctx).transaction(async (tx) => ({
    invitations: await tx.select({ id: invitation.id }).from(invitation),
    emails: await tx
      .select({ id: emailMessage.id, status: emailMessage.status })
      .from(emailMessage),
    assets: await tx
      .select({ id: asset.id, status: asset.status, description: asset.description })
      .from(asset),
  }));
  expect(rows.invitations).toEqual([{ id: t.b.invitation.id }]);
  expect(rows.emails).toEqual([{ id: t.b.email.id, status: 'queued' }]);
  expect(rows.assets).toEqual([
    { id: t.b.asset.id, status: 'waiting', description: t.b.asset.description },
  ]);
}

/** A payload carrying more than the queue's ids is refused: B's data can't ride in a job. */
function expectIdsOnly(queue: QueueName) {
  const payload = { ...payloadInAWithBIds(queue), email: t.b.owner.email, name: t.b.name };
  expect(() => checkPayload(queue, payload)).toThrow(/ids only/);
  expect(() => payloadOf(queue, { data: payload, groupId: t.a.ctx.workspaceId })).toThrow();
}

/** A job of A's whose group is B's (or none), or a job naming B's workspace in A's group, is refused. */
function expectGroupIsItsWorkspace(queue: QueueName) {
  const inA = payloadInAWithBIds(queue);
  expect(() => payloadOf(queue, { data: inA, groupId: t.b.ctx.workspaceId })).toThrow(/group/);
  expect(() => payloadOf(queue, { data: inA, groupId: null })).toThrow(/group/);
  const naming = { ...inA, workspaceId: t.b.ctx.workspaceId };
  expect(() => payloadOf(queue, { data: naming, groupId: t.a.ctx.workspaceId })).toThrow(/group/);
}

/** A job of A's with B's ids runs in A: its handle, `forWorkspace` on A, reaches none of B's rows. */
async function expectRunsInA(queue: QueueName) {
  const payload = payloadOf(queue, {
    data: payloadInAWithBIds(queue),
    groupId: t.a.ctx.workspaceId,
  });
  const workspaceId = workspaceOf(payload);
  expect(workspaceId).toBe(t.a.ctx.workspaceId);
  // The handle `createJobs` gives the handler: forWorkspace on the payload's workspace.
  expect(await reachOfB(t.app.forWorkspace({ workspaceId: workspaceId ?? '' }))).toEqual({
    read: [],
    changed: 0,
    processed: 0,
    removed: 0,
    removedAsset: 0,
  });
  await expectBUntouched();
}

// One block per queue, each named by a string the inventory test reads (a loop's names it can't).
tenancy('queue ai', () => {
  it('refuses B’s data in a job, and a group not the job’s workspace', () => {
    expectIdsOnly('ai');
    expectGroupIsItsWorkspace('ai');
  });
  it('runs a job of A’s with B’s ids in A, where none of B’s rows can be read or changed', () =>
    expectRunsInA('ai'));
});

tenancy('queue asset', () => {
  it('refuses B’s data in a job, and a group not the job’s workspace', () => {
    expectIdsOnly('asset');
    expectGroupIsItsWorkspace('asset');
  });
  it('runs a job of A’s naming B’s brand and asset in A, where neither can be read or changed', () =>
    expectRunsInA('asset'));
});

tenancy('queue render', () => {
  it('refuses B’s data in a job, and a group not the job’s workspace', () => {
    expectIdsOnly('render');
    expectGroupIsItsWorkspace('render');
  });
  it('runs a job of A’s with B’s ids in A, where none of B’s rows can be read or changed', () =>
    expectRunsInA('render'));
});

tenancy('queue fetch', () => {
  it('refuses B’s data in a job, and a group not the job’s workspace', () => {
    expectIdsOnly('fetch');
    expectGroupIsItsWorkspace('fetch');
  });
  it('runs a job of A’s with B’s ids in A, where none of B’s rows can be read or changed', () =>
    expectRunsInA('fetch'));
});

tenancy('queue export', () => {
  it('refuses B’s data in a job, and a group not the job’s workspace', () => {
    expectIdsOnly('export');
    expectGroupIsItsWorkspace('export');
  });
  it('runs a job of A’s with B’s ids in A, where none of B’s rows can be read or changed', () =>
    expectRunsInA('export'));
});

tenancy('queue email', () => {
  it('refuses B’s data in a job, and a group not the job’s workspace', () => {
    expectIdsOnly('email');
    expectGroupIsItsWorkspace('email');
  });
  it('runs a job of A’s with B’s ids in A, where none of B’s rows can be read or changed', () =>
    expectRunsInA('email'));
});

tenancy('queue account-email', () => {
  it('refuses B’s data in a job, and a workspace or a group: it runs in none, with no workspace handle', () => {
    expectIdsOnly('account-email');
    const plain = payloadInAWithBIds('account-email');
    const withWorkspace = { ...plain, workspaceId: t.a.ctx.workspaceId };
    expect(() => checkPayload('account-email', withWorkspace)).toThrow(/ids only/);
    expect(() => payloadOf('account-email', { data: plain, groupId: t.a.ctx.workspaceId })).toThrow(
      /group/,
    );
    expect(workspaceOf(payloadOf('account-email', { data: plain, groupId: null }))).toBeNull();
  });
});

it('the queues tried above are every queue packages/db has', () => {
  expect([...queueNames].sort()).toEqual(
    ['account-email', 'ai', 'asset', 'email', 'export', 'fetch', 'render'].sort(),
  );
});

// ---- The worker's handlers ---------------------------------------------------------------------------------------

/** What apps/worker's handlers are given: the job context `createJobs` builds (packages/db's jobs/boss.ts). */
interface JobRun<P> {
  jobId: string;
  payload: P;
  db: Scoped | null;
  retryCount: number;
  lastAttempt: boolean;
}

interface Delivery {
  transport: { send: (email: { to: string }) => Promise<{ providerId: string }> };
  render: (
    template: string,
    data: unknown,
    context: { appUrl: string },
  ) => Promise<{ subject: string; html: string; text: string }>;
  from: string;
  appUrl: string;
  log: (event: string, fields?: Record<string, string>) => void;
}

/**
 * apps/worker's handlers, loaded by URL, not imported, as the Data journey loads the worker: so the root's typecheck
 * doesn't read @lzp/email's `.tsx` templates (the root tsconfig has no `jsx`); apps/worker is typechecked in its own
 * package. Their types here are the parts this file uses.
 */
async function handlers() {
  const email = (await import(
    new URL('../../apps/worker/src/email-job.ts', import.meta.url).href
  )) as { emailJob: (deps: Delivery) => (job: JobRun<Payload<'email'>>) => Promise<void> };
  const account = (await import(
    new URL('../../apps/worker/src/account-email-job.ts', import.meta.url).href
  )) as {
    accountEmailJob: (
      deps: Delivery & { outbox: ReturnType<typeof createAccountEmails>['outbox'] },
    ) => (job: JobRun<Payload<'account-email'>>) => Promise<void>;
  };
  return { emailJob: email.emailJob, accountEmailJob: account.accountEmailJob };
}

/** The parts of @lzp/storage's `Storage` the asset job uses. */
interface Files {
  get: (
    ctx: WorkspaceCtx,
    key: string,
    options: { maxBytes: number },
  ) => Promise<Uint8Array | null>;
  put: (ctx: WorkspaceCtx, key: string, body: Uint8Array, contentType: string) => Promise<void>;
}

/** apps/worker's `asset` handler, loaded by URL as the email handlers are: its imports resolve in apps/worker. */
async function assetHandler() {
  const module = (await import(
    new URL('../../apps/worker/src/asset-job.ts', import.meta.url).href
  )) as {
    assetJob: (deps: {
      storage: Files;
      log: Delivery['log'];
    }) => (job: JobRun<Payload<'asset'>>) => Promise<void>;
  };
  return module.assetJob;
}

/**
 * A file store in memory, holding `files` by key, that serves any key to any workspace and records each read and
 * write: a handler that reached for B's file would get it, and show here.
 */
function recordingFiles(files: Map<string, Uint8Array>) {
  const asked: string[] = [];
  const store: Files = {
    get: (ctx, key) => {
      asked.push(`get ${ctx.workspaceId} ${key}`);
      return Promise.resolve(files.get(key) ?? null);
    },
    put: (ctx, key, body) => {
      asked.push(`put ${ctx.workspaceId} ${key}`);
      files.set(key, body);
      return Promise.resolve();
    },
  };
  return { store, asked };
}

/** A delivery whose transport and renderer only record: who would have been sent what. */
function recordingDelivery() {
  const sent: string[] = [];
  const rendered: unknown[] = [];
  const delivery: Delivery = {
    transport: {
      send: (email) => {
        sent.push(email.to);
        return Promise.resolve({ providerId: `tenancy-${randomUUID()}` });
      },
    },
    render: (_template, data) => {
      rendered.push(data);
      return Promise.resolve({ subject: 'Tenancy', html: '<p>Tenancy</p>', text: 'Tenancy' });
    },
    from: 'LetZeusPost <tenancy@letzeuspost.invalid>',
    appUrl: loadEnv('web').APP_URL,
    log: () => undefined,
  };
  return { delivery, sent, rendered };
}

describe('the worker’s handlers', () => {
  tenancy('job email', () => {
    it('sends nothing for B’s outbox row in a job of A’s, and leaves the row queued', async () => {
      const { emailJob } = await handlers();
      const { delivery, sent, rendered } = recordingDelivery();
      const handler = emailJob(delivery);
      const run = (emailMessageId: string) =>
        handler({
          jobId: randomUUID(),
          payload: { workspaceId: t.a.ctx.workspaceId, emailMessageId },
          db: t.app.forWorkspace(t.a.ctx),
          retryCount: 0,
          lastAttempt: false,
        });

      await run(t.b.email.id);
      expect(sent).toEqual([]);
      expect(rendered).toEqual([]);
      await expectBUntouched();

      // The same handler does send A's own row: the stand-ins would have seen B's.
      await run(t.a.email.id);
      expect(sent).toEqual([t.a.email.to]);
    });
  });

  tenancy('job account-email', () => {
    it('sends nothing for B’s workspace outbox row given as an account email: it reaches account emails alone', async () => {
      const { accountEmailJob } = await handlers();
      const { delivery, sent, rendered } = recordingDelivery();
      const accountEmails = createAccountEmails(loadEnv('web').DATABASE_URL);
      try {
        const handler = accountEmailJob({ ...delivery, outbox: accountEmails.outbox });
        await handler({
          jobId: randomUUID(),
          payload: { accountEmailId: t.b.email.id },
          db: null,
          retryCount: 0,
          lastAttempt: false,
        });
        expect(sent).toEqual([]);
        expect(rendered).toEqual([]);
        await expectBUntouched();
      } finally {
        await accountEmails.close();
      }
    });
  });

  tenancy('job asset', () => {
    it('reads, writes and changes nothing of B’s for B’s asset in a job of A’s, on any try', async () => {
      const assetJob = await assetHandler();
      const theirs = picture(41);
      const files = new Map([
        [t.b.asset.storageKey, theirs],
        [t.a.asset.storageKey, picture(42)],
      ]);
      const { store, asked } = recordingFiles(files);
      const handler = assetJob({ storage: store, log: () => undefined });
      const run = (brandId: string, assetId: string, lastAttempt: boolean) =>
        handler({
          jobId: randomUUID(),
          payload: { workspaceId: t.a.ctx.workspaceId, brandId, assetId },
          db: t.app.forWorkspace(t.a.ctx),
          retryCount: lastAttempt ? 2 : 0,
          lastAttempt,
        });

      // B's asset under B's brand, and under A's: on a first try and on the last, which would reject what it found.
      for (const lastAttempt of [false, true]) {
        await run(t.b.brand.id, t.b.asset.id, lastAttempt);
        await run(t.a.brand.id, t.b.asset.id, lastAttempt);
      }
      expect(asked).toEqual([]);
      expect(files.get(t.b.asset.storageKey)).toBe(theirs);
      await expectBUntouched();

      // The same handler does process A's own asset: the store would have been asked for B's.
      await run(t.a.brand.id, t.a.asset.id, false);
      const prefixA = `ws/${t.a.ctx.workspaceId}/`;
      expect(asked[0]).toBe(`get ${t.a.ctx.workspaceId} ${t.a.asset.storageKey}`);
      expect(asked.filter((each) => each.startsWith('put '))).toHaveLength(3);
      expect(asked.every((each) => each.includes(` ${t.a.ctx.workspaceId} ${prefixA}`))).toBe(true);
      const mine = await t.app
        .forWorkspace(t.a.ctx)
        .transaction((tx) => tx.select({ id: asset.id, status: asset.status }).from(asset));
      expect(mine).toEqual([{ id: t.a.asset.id, status: 'ready' }]);
      await expectBUntouched();
    });
  });
});

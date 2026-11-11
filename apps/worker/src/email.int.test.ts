// The email job against real Postgres and Mailpit (§13 Jobs and Done when, §17 Integration, #72), in
// `pnpm check:services` and CI's `services` job: the first real job sends an outbox row to Mailpit; running the job
// twice for one row, a job that failed before sending, and a job killed after sending each leave exactly one message;
// a run that lost the database after claiming its row leaves it to the job's retry; and a job never reaches another
// workspace's row. Every workspace, row and address here is this run's; the workspaces go at the end, and their rows
// with them. So the file shares the database with the other services files, which Vitest runs side by side (Argus F1
// on #202): the `email` jobs any of them queues go to whichever worker is running, all of them this real handler.
import { execFileSync } from 'node:child_process';
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { loadEnv } from '@lzp/config';
import {
  createDb,
  createJobs,
  emailMessage,
  emailOutbox,
  installJobs,
  INTERRUPTED,
  migrate,
  queueEmail,
  SENDING_STALE_AFTER_SECONDS,
  workspace,
  type Db,
  type JobContext,
  type Jobs,
} from '@lzp/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emailJob, type EmailJobDeps } from './email-job.ts';
import { log } from './log.ts';
import {
  NotSentError,
  SendOutcomeUnknownError,
  smtpTransport,
  type EmailTransport,
} from './smtp.ts';
import type { Worker } from './worker.ts';

const env = loadEnv('worker');
const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');
const run = randomUUID();
const workspaceId = randomUUIDv7();
const ctx = { workspaceId };
/** Another workspace of this run's, whose row the tenancy test names from `ctx`'s job. */
const otherCtx = { workspaceId: randomUUIDv7() };

/** Mailpit's API, beside its SMTP port (docker/compose.yml). */
const mailpit = `http://${new URL(env.SMTP_URL).hostname}:${process.env.LZP_MAILPIT_PORT ?? '8025'}`;

interface MailpitSummary {
  ID: string;
  To: { Address: string }[];
}

/** The messages Mailpit caught for `to`. */
async function inbox(to: string): Promise<MailpitSummary[]> {
  const response = await fetch(
    `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`,
  );
  if (!response.ok) throw new Error(`mailpit: ${String(response.status)}`);
  const { messages } = (await response.json()) as { messages: MailpitSummary[] };
  return messages.filter((message) => message.To.some((addressee) => addressee.Address === to));
}

async function waitFor<T>(what: string, check: () => T | Promise<T>, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

let db: Db;
let sender: Jobs;
let worker: Worker;
let deps: Omit<EmailJobDeps, 'transport'>;
let smtp: EmailTransport;

async function rowStatus(id: string): Promise<string | undefined> {
  const rows = await db
    .forWorkspace(ctx)
    .transaction((tx) =>
      tx.select({ id: emailMessage.id, status: emailMessage.status }).from(emailMessage),
    );
  return rows.find((row) => row.id === id)?.status;
}

async function rowFailure(id: string): Promise<string | null | undefined> {
  const rows = await db
    .forWorkspace(ctx)
    .transaction((tx) =>
      tx.select({ id: emailMessage.id, failure: emailMessage.failure }).from(emailMessage),
    );
  return rows.find((row) => row.id === id)?.failure;
}

/**
 * As if every row of this run's workspace had last moved `seconds` ago (a minute more, for the clocks of this machine
 * and the database). The rows of the earlier tests are sent already, where their age doesn't matter.
 */
async function age(seconds: number): Promise<void> {
  await db.forWorkspace(ctx).transaction(async (tx) => {
    await tx.update(emailMessage).set({ updatedAt: new Date(Date.now() - (seconds + 60) * 1000) });
  });
}

/** A transport that sends, then holds the run there until `finish` is called: a run caught mid-send. */
function holdsAfterSending() {
  let finish: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let sent: () => void = () => undefined;
  const hasSent = new Promise<void>((resolve) => {
    sent = resolve;
  });
  const transport: EmailTransport = {
    send: async (email) => {
      const result = await smtp.send(email);
      sent();
      await held;
      return result;
    },
    close: () => undefined,
  };
  return { transport, hasSent, finish };
}

/** Queues a row for `to`, as a feature would. */
function queue(to: string): Promise<string> {
  return queueEmail(sender, db, ctx, {
    template: 'email-check',
    to,
    replyTo: `reply-${run}@example.test`,
    data: { name: 'গল্প ক্যাফে' },
  });
}

/** A row with no job queued for it, so only the runs a test makes touch it. */
async function rowWithoutJob(to: string): Promise<string> {
  const [row] = await db.forWorkspace(ctx).transaction((tx) =>
    tx
      .insert(emailMessage)
      .values({
        workspaceId,
        template: 'email-check',
        toAddress: to,
        data: { name: 'Picasso Studio' },
      })
      .returning({ id: emailMessage.id }),
  );
  if (row === undefined) throw new Error('no row');
  return row.id;
}

/** What pg-boss hands the handler for one run of the row's job: a new job, or a retry of `jobId`. */
function jobFor(emailMessageId: string, jobId: string = randomUUID()): JobContext<'email'> {
  return {
    jobId,
    payload: { workspaceId, emailMessageId },
    db: db.forWorkspace(ctx),
    retryCount: 0,
    lastAttempt: false,
  };
}

/** The steps after the send, each of which writes the row. */
type Bookkeeping = 'sent' | 'release' | 'fail';

/** packages/db's outbox, except that the database drops while `step` writes the row. */
function outboxDroppingAt(step: Bookkeeping): EmailJobDeps['outbox'] {
  return (scoped) => ({
    ...emailOutbox(scoped),
    [step]: () => Promise.reject(new Error('Connection terminated unexpectedly')),
  });
}

/** A transport whose send breaks off after the message may have reached the server, without sending it. */
const brokenOff: EmailTransport = {
  send: () => Promise.reject(new SendOutcomeUnknownError('ESOCKET')),
  close: () => undefined,
};

beforeAll(async () => {
  // Q8: the worker renders @lzp/email's built output.
  execFileSync('pnpm', ['--filter', '@lzp/email', 'build'], { stdio: 'ignore' });
  const [{ startWorker }, { renderTemplate }] = await Promise.all([
    import('./worker.ts'),
    import('@lzp/email'),
  ]);
  await migrate(ownerUrl);
  await installJobs(ownerUrl);
  db = createDb(env.DATABASE_URL);
  for (const [each, label] of [
    [ctx, 'a'],
    [otherCtx, 'b'],
  ] as const) {
    await db.forWorkspace(each).transaction(async (tx) => {
      await tx.insert(workspace).values({
        id: each.workspaceId,
        name: `Email ${label} ${run}`,
        slug: `email-${label}-${run}`,
      });
    });
  }
  sender = createJobs({
    url: env.DATABASE_URL,
    db,
    onError: (error) => {
      console.error(`jobs: ${error.name}`);
    },
  });
  await sender.start();
  worker = await startWorker(env, { pollingIntervalSeconds: 0.5 });
  smtp = smtpTransport(env.SMTP_URL);
  deps = { render: renderTemplate, from: env.EMAIL_FROM, appUrl: env.APP_URL, log };
}, 120_000);

afterAll(async () => {
  await worker.stop();
  await sender.stop();
  smtp.close();
  for (const each of [ctx, otherCtx]) {
    await db.forWorkspace(each).transaction(async (tx) => {
      await tx.delete(workspace); // row-level security: only this run's workspace; its rows go with it
    });
  }
  await db.close();
});

// Each test waits up to 30 s for Mailpit or the row (waitFor), so vitest's own limit is longer than that.
describe('the email job (§13: a retried job never sends twice)', { timeout: 60_000 }, () => {
  it('the first real job: a queued row reaches Mailpit through the worker, with HTML and plain text', async () => {
    const to = `first-${run}@example.test`;
    const id = await queue(to);
    const [message] = await waitFor('the email in Mailpit', async () => {
      const found = await inbox(to);
      return found.length > 0 ? found : undefined;
    });
    const response = await fetch(`${mailpit}/api/v1/message/${message?.ID ?? ''}`);
    const full = (await response.json()) as {
      HTML: string;
      Text: string;
      ReplyTo: { Address: string }[];
      MessageID: string;
    };
    expect(full.HTML).toContain('গল্প ক্যাফে');
    expect(full.Text).toContain('গল্প ক্যাফে');
    expect(full.Text).toContain(env.APP_URL); // the button's link, in the plain-text version too
    expect(full.ReplyTo.map((addressee) => addressee.Address)).toEqual([
      `reply-${run}@example.test`,
    ]);
    expect(full.MessageID).toContain(id);
    await waitFor('the row marked sent', async () => (await rowStatus(id)) === 'sent');
    expect(await inbox(to)).toHaveLength(1);
  });

  it('running the job twice for one row, one after the other or at once, puts one message in Mailpit', async () => {
    const to = `twice-${run}@example.test`;
    const id = await queue(to); // the worker runs this row's job too
    const handler = emailJob({ ...deps, transport: smtp });
    await Promise.all([handler(jobFor(id)), handler(jobFor(id))]);
    await handler(jobFor(id));
    await waitFor('the row marked sent', async () => (await rowStatus(id)) === 'sent');
    expect(await inbox(to)).toHaveLength(1);
  });

  it('a second run while the first is mid-send sends nothing, and the first records the send', async () => {
    const to = `mid-send-${run}@example.test`;
    const id = await rowWithoutJob(to);
    const first = holdsAfterSending();
    const firstRun = emailJob({ ...deps, transport: first.transport })(jobFor(id));
    await first.hasSent; // the message is out; the first run hasn't recorded it yet
    await emailJob({ ...deps, transport: smtp })(jobFor(id)); // the second run
    expect(await rowStatus(id)).toBe('sending'); // left to the first run, not marked failed
    first.finish();
    await firstRun;
    expect(await rowStatus(id)).toBe('sent');
    await waitFor('the email in Mailpit', async () => (await inbox(to)).length > 0);
    expect(await inbox(to)).toHaveLength(1);
  });

  it('a job that failed before sending sends once on retry', async () => {
    const to = `retry-${run}@example.test`;
    const id = await rowWithoutJob(to);
    // Nothing listens on port 9: the connection is refused, so the email certainly didn't go out. The code nodemailer
    // gives it differs by machine (ECONNECTION, ESOCKET), so the test checks the outcome, not the code.
    const down = smtpTransport('smtp://127.0.0.1:9');
    try {
      await expect(emailJob({ ...deps, transport: down })(jobFor(id))).rejects.toBeInstanceOf(
        NotSentError,
      );
    } finally {
      down.close();
    }
    expect(await rowStatus(id)).toBe('queued'); // put back for the retry
    await emailJob({ ...deps, transport: smtp })(jobFor(id)); // the retry
    await waitFor('the row marked sent', async () => (await rowStatus(id)) === 'sent');
    expect(await inbox(to)).toHaveLength(1);
  });

  it('a job killed after sending, before it recorded the send, sends nothing on retry', async () => {
    const to = `killed-${run}@example.test`;
    const id = await rowWithoutJob(to);
    // The message goes out, then the run never comes back: as if its process were killed there.
    const killed = holdsAfterSending();
    void emailJob({ ...deps, transport: killed.transport })(jobFor(id));
    await killed.hasSent;
    expect(await rowStatus(id)).toBe('sending'); // where the killed run left it
    // pg-boss retries a killed job only once it has expired, so the retry finds the row that old.
    await age(SENDING_STALE_AFTER_SECONDS);
    await emailJob({ ...deps, transport: smtp })(jobFor(id)); // the retry
    await waitFor('the email in Mailpit', async () => (await inbox(to)).length > 0);
    expect(await inbox(to)).toHaveLength(1);
    expect(await rowStatus(id)).toBe('failed'); // interrupted: never sent again, and says why
    expect(await rowFailure(id)).toBe(INTERRUPTED);
    // The killed run is never let go: a killed process doesn't come back.
  });

  // Argus F1 on #197: the database drops while the run writes the row after the send, leaving it claimed. The run
  // fails, so pg-boss retries the same job (same id); the retry finds its own job's claim, so the run that made it is
  // over, and marks the row interrupted: it is never sent twice, and never left claimed.
  it.each([
    ['sent', 'the email went out', 1],
    ['release', 'the email certainly did not go out', 0],
    ['fail', 'the send broke off', 0],
  ] as const)(
    'a run whose database dropped during %s() (%s) leaves the row to its retry, which marks it interrupted',
    async (step, _, messages) => {
      const to = `dropped-in-${step}-${run}@example.test`;
      const id = await rowWithoutJob(to);
      const jobId = randomUUID();
      const down = smtpTransport('smtp://127.0.0.1:9'); // refused: the email certainly doesn't go out
      const transport = { sent: smtp, release: down, fail: brokenOff }[step];
      try {
        await expect(
          emailJob({ ...deps, transport, outbox: outboxDroppingAt(step) })(jobFor(id, jobId)),
        ).rejects.toThrow();
      } finally {
        down.close();
      }
      expect(await rowStatus(id)).toBe('sending'); // claimed by the run that lost the database
      await emailJob({ ...deps, transport: smtp })(jobFor(id, jobId)); // pg-boss's retry of that job
      expect(await rowStatus(id)).toBe('failed');
      expect(await rowFailure(id)).toBe(INTERRUPTED);
      if (messages > 0) await waitFor('the email in Mailpit', async () => (await inbox(to)).length);
      expect(await inbox(to)).toHaveLength(messages);
    },
  );

  // The tenant-isolation skill: the job with the other workspace's ids. The handler's only handle is `db.forWorkspace`
  // for the payload's workspace, so the row's id alone reaches nothing (Cerberus F1 on #202).
  it("a job for this workspace naming another workspace's row sends nothing and changes nothing of it", async () => {
    const to = `other-workspace-${run}@example.test`;
    const [row] = await db.forWorkspace(otherCtx).transaction((tx) =>
      tx
        .insert(emailMessage)
        .values({
          workspaceId: otherCtx.workspaceId,
          template: 'email-check',
          toAddress: to,
          data: { name: 'Picasso Studio' },
        })
        .returning({ id: emailMessage.id }),
    );
    if (row === undefined) throw new Error('no row');
    await emailJob({ ...deps, transport: smtp })(jobFor(row.id)); // payload and handle: this workspace's
    const [after] = await db
      .forWorkspace(otherCtx)
      .transaction((tx) =>
        tx
          .select({ status: emailMessage.status, claimedByJob: emailMessage.claimedByJob })
          .from(emailMessage),
      );
    expect(after).toEqual({ status: 'queued', claimedByJob: null });
    expect(await inbox(to)).toHaveLength(0);
  });
});

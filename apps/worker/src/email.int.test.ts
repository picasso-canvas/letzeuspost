// The email job against real Postgres and Mailpit (§13 Jobs and Done when, §17 Integration, #72), in
// `pnpm check:services` and CI's `services` job: the first real job sends an outbox row to Mailpit; running the job
// twice for one row, a job that failed before sending, and a job killed after sending each leave exactly one message.
// Every workspace, row and address here is this run's; the workspace goes at the end, and its rows with it.
import { execFileSync } from 'node:child_process';
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { loadEnv } from '@lzp/config';
import {
  createDb,
  createJobs,
  emailMessage,
  installJobs,
  migrate,
  queueEmail,
  workspace,
  type Db,
  type JobContext,
  type Jobs,
} from '@lzp/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emailJob, type EmailJobDeps } from './email-job.ts';
import { log } from './log.ts';
import { smtpTransport, type EmailTransport } from './smtp.ts';
import type { Worker } from './worker.ts';

const env = loadEnv('worker');
const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');
const run = randomUUID();
const workspaceId = randomUUIDv7();
const ctx = { workspaceId };

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

/** What pg-boss hands the handler for one run of the row's job. */
function jobFor(emailMessageId: string, lastAttempt = false): JobContext<'email'> {
  return {
    jobId: randomUUIDv7(),
    payload: { workspaceId, emailMessageId },
    db: db.forWorkspace(ctx),
    retryCount: 0,
    lastAttempt,
  };
}

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
  await db.forWorkspace(ctx).transaction(async (tx) => {
    await tx
      .insert(workspace)
      .values({ id: workspaceId, name: `Email ${run}`, slug: `email-${run}` });
  });
  sender = createJobs({ url: env.DATABASE_URL, db });
  await sender.start();
  worker = await startWorker(env, { pollingIntervalSeconds: 0.5 });
  smtp = smtpTransport(env.SMTP_URL);
  deps = { render: renderTemplate, from: env.EMAIL_FROM, appUrl: env.APP_URL, log };
}, 120_000);

afterAll(async () => {
  await worker.stop();
  await sender.stop();
  smtp.close();
  await db.forWorkspace(ctx).transaction(async (tx) => {
    await tx.delete(workspace); // row-level security: only this run's workspace; its rows go with it
  });
  await db.close();
});

describe('the email job (§13: a retried job never sends twice)', () => {
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

  it('a job that failed before sending sends once on retry', async () => {
    const to = `retry-${run}@example.test`;
    const id = await rowWithoutJob(to);
    // Nothing listens on port 9: the connection is refused, so the email certainly didn't go out.
    const down = smtpTransport('smtp://127.0.0.1:9');
    try {
      await expect(emailJob({ ...deps, transport: down })(jobFor(id))).rejects.toThrow(
        'ECONNECTION',
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
    // The message goes out, then the run dies before it can mark the row sent.
    const dies: EmailTransport = {
      send: async (email) => {
        await smtp.send(email);
        throw new Error('killed');
      },
      close: () => undefined,
    };
    await expect(emailJob({ ...deps, transport: dies })(jobFor(id))).rejects.toThrow();
    expect(await rowStatus(id)).toBe('sending'); // where the killed run left it
    await emailJob({ ...deps, transport: smtp })(jobFor(id)); // the retry
    await waitFor('the email in Mailpit', async () => (await inbox(to)).length > 0);
    expect(await inbox(to)).toHaveLength(1);
    expect(await rowStatus(id)).toBe('failed'); // interrupted: never sent again, and says why
  });
});

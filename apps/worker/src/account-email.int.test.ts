// The account-email job against real Postgres and Mailpit (#77, Argus F2 on #229), in `pnpm check:services` and CI's
// `services` job: a sign-in request through packages/auth's route handler writes one outbox row and queues its job;
// the worker (startWorker) sends it to Mailpit; and running that job again, one run after another or two at once, as
// pg-boss's retries would, sends nothing more. The worker reaches the row only through packages/auth
// (`createAccountEmails`), never @lzp/db/auth itself (Athena's decision 3).
//
// The person, their outbox row, their link and their rate-limit buckets are this run's, made here and removed at the
// end. The owner role makes and removes the person (the app role can't, #176), as the Sign-in journey does.
import { execFileSync } from 'node:child_process';
import { randomUUID, randomUUIDv7 } from 'node:crypto';
import {
  createAccountEmails,
  createAuthServer,
  signInBucket,
  type AccountEmails,
  type AuthServer,
} from '@lzp/auth';
import { loadEnv } from '@lzp/config';
import { createDb, installJobs, migrate, type Db, type JobContext } from '@lzp/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountEmailJob, type AccountEmailJobDeps } from './account-email-job.ts';
import { log } from './log.ts';
import { smtpTransport, type EmailTransport } from './smtp.ts';
import type { Worker } from './worker.ts';

const env = loadEnv('worker');
const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');
const run = randomUUID();
const secret = `integration-only-${run}`;
const to = `sign-in-${run}@example.test`;
const ip = '192.0.2.77';

/** Mailpit's API, beside its SMTP port (docker/compose.yml). */
const mailpit = `http://${new URL(env.SMTP_URL).hostname}:${process.env.LZP_MAILPIT_PORT ?? '8025'}`;

/** The messages Mailpit caught for `to`. */
async function inbox(): Promise<{ ID: string }[]> {
  const response = await fetch(
    `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`,
  );
  if (!response.ok) throw new Error(`mailpit: ${String(response.status)}`);
  const { messages } = (await response.json()) as {
    messages: { ID: string; To: { Address: string }[] }[];
  };
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

/** A query as text, each `${value}` a quoted literal; every value is one this file made (the journey's way). */
function text(strings: TemplateStringsArray, ...values: string[]): string {
  return strings.reduce(
    (query, part, i) =>
      query + part + (values[i] === undefined ? '' : `'${values[i].replaceAll("'", "''")}'`),
    '',
  );
}

let owner: Db;
let server: AuthServer;
let accountEmails: AccountEmails;
let worker: Worker;
let smtp: EmailTransport;
let deps: Omit<AccountEmailJobDeps, 'transport'>;

/** As the owner role, which holds every table: the only way in to the person and their rows from here. */
async function asOwner<T>(statement: string): Promise<T[]> {
  const result = await owner
    .forWorkspace({ workspaceId: randomUUIDv7() })
    .transaction((tx) => tx.execute(statement));
  return result.rows as T[];
}

const outboxRows = () =>
  asOwner<{ id: string; status: string; data: unknown }>(
    text`select id, status, data from account_email where to_address = ${to}`,
  );

/** One run of the row's job, as pg-boss hands it over: a new job, or a retry of one. */
function jobFor(accountEmailId: string): JobContext<'account-email'> {
  return {
    jobId: randomUUID(),
    payload: { accountEmailId },
    db: null,
    retryCount: 0,
    lastAttempt: false,
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
  owner = createDb(ownerUrl);
  await asOwner(text`insert into "user" (name, email) values (${`Sign-in ${run}`}, ${to})`);
  server = createAuthServer({
    DATABASE_URL: env.DATABASE_URL,
    AUTH_SECRET: secret,
    APP_URL: env.APP_URL,
    LZP_ENV: 'ci',
  });
  accountEmails = createAccountEmails(env.DATABASE_URL);
  worker = await startWorker(env, { pollingIntervalSeconds: 0.5 });
  smtp = smtpTransport(env.SMTP_URL);
  deps = {
    outbox: accountEmails.outbox,
    render: renderTemplate,
    from: env.EMAIL_FROM,
    appUrl: env.APP_URL,
    log,
  };
}, 120_000);

afterAll(async () => {
  await worker.stop();
  smtp.close();
  await Promise.all([server.close(), accountEmails.close()]);
  // The outbox row goes with the person (the cascade); their link and buckets by name.
  await asOwner(text`delete from "user" where email = ${to}`);
  await asOwner(text`delete from verification where value like ${`%${to}%`}`);
  await asOwner(
    text`delete from rate_limit_hit where bucket in (${signInBucket(secret, 'ip', ip)}, ${signInBucket(secret, 'address', to)})`,
  );
  await owner.close();
});

// Each step waits up to 30 s for Mailpit or the row (waitFor), so vitest's own limit is longer than that.
describe('the account-email job (Argus F2 on #229)', { timeout: 60_000 }, () => {
  it('one sign-in link reaches Mailpit once, however many times its job runs', async () => {
    const pending: (() => Promise<void>)[] = [];
    const response = await server.handler(
      new Request(`${env.APP_URL}/api/auth/sign-in/magic-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: env.APP_URL, 'x-forwarded-for': ip },
        body: JSON.stringify({ email: to, callbackURL: '/app' }),
      }),
      (task) => {
        pending.push(task);
      },
    );
    expect(response.status).toBe(200);
    for (const task of pending) await task(); // what Next's after() runs once the answer is sent

    const [row, ...more] = await outboxRows();
    expect(more).toEqual([]);
    if (row === undefined) throw new Error('no outbox row');

    // The worker runs the job it queued.
    const [message] = await waitFor('the email in Mailpit', async () => {
      const found = await inbox();
      return found.length > 0 ? found : undefined;
    });
    const full = (await (await fetch(`${mailpit}/api/v1/message/${message?.ID ?? ''}`)).json()) as {
      Text: string;
      Subject: string;
    };
    expect(full.Subject).toBe('Your LetZeusPost sign-in link');
    expect(full.Text).toContain(`${env.APP_URL}/api/auth/magic-link/verify?token=`);
    expect(full.Text).toContain('10 minutes');

    // pg-boss's retries of the same row: two at once, then one more.
    const handler = accountEmailJob({ ...deps, transport: smtp });
    await Promise.all([handler(jobFor(row.id)), handler(jobFor(row.id))]);
    await handler(jobFor(row.id));
    await waitFor('the row marked sent', async () => (await outboxRows())[0]?.status === 'sent');
    expect(await inbox()).toHaveLength(1);
    // Sent, the row keeps no link.
    expect((await outboxRows())[0]?.data).toEqual({});
  });
});

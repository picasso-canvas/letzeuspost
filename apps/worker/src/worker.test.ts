// What the worker runs (§13 What runs), checked without services: startWorker registers the `email` job and, from
// #77, the `account-email` job on packages/auth's account emails (Argus F2 on #229), and closes them on stop. The
// queue, the database and the templates are stand-ins; account-email.int.test.ts runs the real ones.
import { randomUUIDv7 } from 'node:crypto';
import type { EmailOutbox, JobContext, JobHandler, QueueName } from '@lzp/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({
  handlers: new Map<string, unknown>(),
  loaded: [] as string[],
  closed: [] as string[],
  openedWith: [] as string[],
}));

vi.mock('@lzp/db', () => ({
  emailOutbox: () => ({}),
  createDb: () => ({
    close: () => {
      seen.closed.push('db');
      return Promise.resolve();
    },
  }),
  createJobs: () => ({
    start: () => Promise.resolve(),
    stop: () => {
      seen.closed.push('jobs');
      return Promise.resolve();
    },
    work: (queue: string, handler: unknown) => {
      seen.handlers.set(queue, handler);
      return Promise.resolve();
    },
  }),
}));

vi.mock('@lzp/auth', () => ({
  createAccountEmails: (url: string) => {
    seen.openedWith.push(url);
    const outbox: Pick<EmailOutbox, 'load'> = {
      load: (id) => {
        seen.loaded.push(id);
        return Promise.resolve({ skip: 'sent' as const });
      },
    };
    return {
      outbox,
      close: () => {
        seen.closed.push('account emails');
        return Promise.resolve();
      },
    };
  },
}));

vi.mock('@lzp/email', () => ({ renderTemplate: () => Promise.reject(new Error('not here')) }));

const env = {
  LZP_ENV: 'development',
  DATABASE_URL: 'postgres://lzp_app@localhost:5432/letzeuspost',
  STORAGE_ENDPOINT: 'http://localhost:8333',
  STORAGE_REGION: 'us-east-1',
  STORAGE_BUCKET: 'letzeuspost-dev',
  STORAGE_ACCESS_KEY_ID: 'unused',
  STORAGE_SECRET_ACCESS_KEY: 'unused',
  SMTP_URL: 'smtp://localhost:1025',
  EMAIL_FROM: 'posts@letzeuspost.test',
  APP_URL: 'http://localhost:3000',
} as const;

beforeEach(() => {
  seen.handlers.clear();
  seen.loaded.length = 0;
  seen.closed.length = 0;
  seen.openedWith.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true); // the worker's log lines
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startWorker', () => {
  it('runs the email job and the account-email job', async () => {
    const { startWorker } = await import('./worker.ts');
    const worker = await startWorker(env);
    expect([...seen.handlers.keys()]).toEqual(['email', 'account-email']);
    await worker.stop();
  });

  it("gives the account-email job packages/auth's account emails, on the worker's DATABASE_URL", async () => {
    const { startWorker } = await import('./worker.ts');
    const worker = await startWorker(env);
    expect(seen.openedWith).toEqual([env.DATABASE_URL]);
    const accountEmailId = randomUUIDv7();
    const handler = seen.handlers.get('account-email') as JobHandler<'account-email'> | undefined;
    const job: JobContext<'account-email' & QueueName> = {
      jobId: randomUUIDv7(),
      payload: { accountEmailId },
      db: null,
      retryCount: 0,
      lastAttempt: false,
    };
    await handler?.(job);
    expect(seen.loaded).toEqual([accountEmailId]);
    await worker.stop();
  });

  it('closes the account emails on stop, once the jobs have stopped', async () => {
    const { startWorker } = await import('./worker.ts');
    const worker = await startWorker(env);
    await worker.stop();
    expect(seen.closed).toEqual(['jobs', 'account emails', 'db']);
  });
});

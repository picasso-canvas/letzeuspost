// The worker (§13 What runs): pg-boss on the same Postgres, as the app role, running every job's handler. For now
// the `email` job; the ai, render, fetch and export handlers and the scheduled jobs come with their features.
import type { Env } from '@lzp/config';
import { createDb, createJobs } from '@lzp/db';
import { renderTemplate } from '@lzp/email';
import { emailJob } from './email-job.ts';
import { log } from './log.ts';
import { smtpTransport } from './smtp.ts';

export interface Worker {
  /** Lets running jobs finish, then closes the queue, the mail connection and the database. */
  stop: () => Promise<void>;
}

export async function startWorker(
  env: Env<'worker'>,
  options: { pollingIntervalSeconds?: number } = {},
): Promise<Worker> {
  const db = createDb(env.DATABASE_URL);
  const jobs = createJobs({
    url: env.DATABASE_URL,
    db,
    // pg-boss's own failures, by kind: its messages may quote a statement, so they stay out of the log.
    onError: (error) => {
      log('jobs.error', { error: error.name, code: (error as { code?: string }).code });
    },
    ...options,
  });
  const transport = smtpTransport(env.SMTP_URL);
  await jobs.start();
  await jobs.work(
    'email',
    emailJob({ transport, render: renderTemplate, from: env.EMAIL_FROM, appUrl: env.APP_URL, log }),
  );
  log('worker.started');
  return {
    stop: async () => {
      await jobs.stop();
      transport.close();
      await db.close();
      log('worker.stopped');
    },
  };
}

// The `account-email` job (#77, Athena's decision 3, 2026-11-11): sends one row of the account emails' outbox, a
// sign-in link. The row is a person's, not a workspace's, so the job runs in none: its payload is the row's id, and
// its outbox comes from packages/auth (`createAccountEmails`), on the auth handle the worker never opens itself. The
// steps are the `email` job's (./email-job.ts), so it is safe to run twice and retries as that job does.
import type { EmailOutbox, JobHandler } from '@lzp/db';
import { deliver, type DeliveryDeps } from './email-job.ts';

export interface AccountEmailJobDeps extends DeliveryDeps {
  /** packages/auth's `createAccountEmails(url).outbox`. */
  readonly outbox: EmailOutbox;
}

export function accountEmailJob(deps: AccountEmailJobDeps): JobHandler<'account-email'> {
  return ({ jobId, payload, lastAttempt }) =>
    deliver(deps, deps.outbox, {
      jobId,
      id: payload.accountEmailId,
      idField: 'accountEmailId',
      lastAttempt,
    });
}

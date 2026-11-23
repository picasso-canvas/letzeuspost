// The email outbox's sweep (#210): finds the outbox rows an `email` job's last run left `sending` and marks them failed
// as interrupted, so none sits there unnoticed. A run that lost the database after claiming its row is retried, and the
// retry marks the row (./email-job.ts, step 1); a last run gets no retry, so this sweep does it instead.
// - Which workspaces: those of `email` jobs that failed for good (packages/db's `failedWorkspaces`), since only such a
//   job leaves a row `sending` with nothing to load it again. The worker can't list workspaces: row-level security
//   shows it one at a time.
// - In each, through `db.forWorkspace` for it, rows `sending` past the email job's expiry are marked interrupted, by
//   the rule a retry's load uses (packages/db's email-outbox.ts), in one conditional update: safe to run twice, and
//   beside a live run.
// - It never sends, nor puts a row back in the queue: an interrupted row may have gone out, so it waits for a person.
// A failure rejects the run; what it marked stays marked, and the next run carries on.
// Nothing runs it on a schedule yet: pg-boss's cron pass can't start as the app role, and a queue of its own needs the
// tenancy suite to know it (#210's needs-zeus). Its run takes `{ jobId }`, as a job handler does, for that queue.
// The log names rows and workspaces by id: never an address or content.
import { emailOutbox, type Db, type Jobs, type Scoped } from '@lzp/db';
import type { Log } from './log.ts';

export interface EmailSweepDeps {
  /** The worker's database: the sweep opens `forWorkspace` for each workspace it finds. */
  readonly db: Db;
  readonly jobs: Pick<Jobs, 'failedWorkspaces'>;
  readonly log: Log;
  /** One workspace's step; packages/db's `emailOutbox(db).interruptStale` by default. */
  readonly interrupt?: (db: Scoped) => Promise<string[]>;
}

/** One sweep run; `jobId` names the run in the log. */
export type EmailSweep = (run: { readonly jobId: string }) => Promise<void>;

export function emailSweep(deps: EmailSweepDeps): EmailSweep {
  const interrupt = deps.interrupt ?? ((db: Scoped) => emailOutbox(db).interruptStale());
  return async ({ jobId }) => {
    const workspaces = await deps.jobs.failedWorkspaces('email');
    let interrupted = 0;
    for (const workspaceId of workspaces) {
      for (const emailMessageId of await interrupt(deps.db.forWorkspace({ workspaceId }))) {
        interrupted += 1;
        deps.log('email.interrupted', { jobId, workspaceId, emailMessageId });
      }
    }
    deps.log('email.swept', { jobId, workspaces: workspaces.length, interrupted });
  };
}

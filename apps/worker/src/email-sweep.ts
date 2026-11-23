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
// - What runs it: a timer in the worker (`scheduleEmailSweep`), with no queue and no job (Zeus, option D on #322):
//   pg-boss's cron pass can't start as the app role. Every worker runs its own timer, which is harmless, since the
//   sweep is safe to run twice.
// The log names runs, rows and workspaces by id: never an address or content.
import { randomUUIDv7 } from 'node:crypto';
import { emailOutbox, SENDING_STALE_AFTER_SECONDS, type Db, type Jobs, type Scoped } from '@lzp/db';
import type { Log } from './log.ts';

export interface EmailSweepDeps {
  /** The worker's database: the sweep opens `forWorkspace` for each workspace it finds. */
  readonly db: Db;
  readonly jobs: Pick<Jobs, 'failedWorkspaces'>;
  readonly log: Log;
  /** One workspace's step; packages/db's `emailOutbox(db).interruptStale` by default. */
  readonly interrupt?: (db: Scoped) => Promise<string[]>;
}

/** One sweep run; `runId` names the run in the log. */
export type EmailSweep = (run: { readonly runId: string }) => Promise<void>;

export function emailSweep(deps: EmailSweepDeps): EmailSweep {
  const interrupt = deps.interrupt ?? ((db: Scoped) => emailOutbox(db).interruptStale());
  return async ({ runId }) => {
    const workspaces = await deps.jobs.failedWorkspaces('email');
    let interrupted = 0;
    for (const workspaceId of workspaces) {
      for (const emailMessageId of await interrupt(deps.db.forWorkspace({ workspaceId }))) {
        interrupted += 1;
        deps.log('email.interrupted', { runId, workspaceId, emailMessageId });
      }
    }
    deps.log('email.swept', { runId, workspaces: workspaces.length, interrupted });
  };
}

/**
 * How often the worker sweeps: a third of the staleness window (5 minutes), so a row is marked at most 5 minutes after
 * it counts as stale, and a run is short next to the gap.
 */
export const EMAIL_SWEEP_EVERY_MS = (SENDING_STALE_AFTER_SECONDS * 1000) / 3;

export interface EmailSweepTimer {
  /** No run starts after this; resolves once the run in flight, if any, has ended. */
  readonly stop: () => Promise<void>;
}

/**
 * Runs `sweep` every EMAIL_SWEEP_EVERY_MS, the first one interval after the start, and never two at once: a tick that
 * finds a run still going is skipped. A failed run is logged by its error's name only (a database error's message may
 * quote a statement) and the next tick tries again.
 */
export function scheduleEmailSweep(sweep: EmailSweep, log: Log): EmailSweepTimer {
  let running: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (running) return;
    const runId = randomUUIDv7();
    running = sweep({ runId })
      .catch((error: unknown) => {
        log('email.sweep-failed', {
          runId,
          error: error instanceof Error ? error.name : 'unknown',
        });
      })
      .finally(() => {
        running = undefined;
      });
  }, EMAIL_SWEEP_EVERY_MS);
  // The queue keeps the worker alive; the timer alone never holds the process open.
  timer.unref();
  return {
    stop: async () => {
      clearInterval(timer);
      await running;
    },
  };
}

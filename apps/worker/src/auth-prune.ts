// The auth tables' prune (#323): sign-in's two tables, lzp_auth's alone, emptied of what has expired, on a timer in the
// worker (./schedule.ts, the email sweep's, #210). packages/auth gives the steps (`createAccountEmails(url).prune`), on
// its auth handle: the worker never opens @lzp/db/auth itself (Athena's decision 3).
// - `rate_limit_hit`: every hit older than the longest window any bucket counts in, in every bucket.
// - `account_email`: every sent or failed row past its retention window.
// Both are safe to run twice and beside a live sign-in (packages/db's auth-prune.ts). A step that fails is logged and
// the other still runs; the run then rejects, and the next run carries on.
// The log names the run and counts rows: never an address or a bucket key.
import type { AccountEmails } from '@lzp/auth';
import type { Log, LogFields } from './log.ts';
import { errorName, every, type Run, type Timer } from './schedule.ts';

export interface AuthPruneDeps {
  /** packages/auth's `createAccountEmails(url).prune`. */
  readonly prune: AccountEmails['prune'];
  readonly log: Log;
}

/** One prune run: each table's step in turn, then one line with the counts. */
export function authPrune(deps: AuthPruneDeps): Run {
  const steps = [
    ['rate_limit_hit', 'rateLimitHits', deps.prune.rateLimitHits],
    ['account_email', 'accountEmails', deps.prune.accountEmails],
  ] as const;
  return async ({ runId }) => {
    const counts: Record<string, number> = {};
    let failed = 0;
    for (const [table, field, step] of steps) {
      try {
        counts[field] = await step();
      } catch (error) {
        // Logged by its error's name only: a database error's message may quote a statement, a bucket or an address.
        failed += 1;
        deps.log('auth.prune-table-failed', { runId, table, error: errorName(error) });
      }
    }
    const fields: LogFields = { runId, ...counts, failed };
    deps.log('auth.pruned', fields);
    if (failed > 0) throw new Error(`The auth prune failed on ${String(failed)} table(s)`);
  };
}

/**
 * How often the worker prunes: every 15 minutes, so a rate-limit hit outlives the longest window (an hour) by 15
 * minutes at most, and each run has little to delete.
 */
export const AUTH_PRUNE_EVERY_MS = 15 * 60 * 1000;

/** Runs `prune` every AUTH_PRUNE_EVERY_MS on the worker's timer; a failed run logs `auth.prune-failed`. */
export function scheduleAuthPrune(prune: Run, log: Log): Timer {
  return every(AUTH_PRUNE_EVERY_MS, 'auth.prune-failed', prune, log);
}

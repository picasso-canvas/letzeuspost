// The auth tables' prune (#323, Cerberus F4 on #229 and F1 on #322): sign-in's two tables, lzp_auth's alone, would
// otherwise grow for ever. `hitRateLimit` deletes old hits only in the bucket it counts, so a bucket never hit again
// keeps its rows; and `account_email` keeps an address in every row it ever wrote. The worker runs both steps on a
// timer, through packages/auth, on the auth handle (`AuthDb.db`): exported from @lzp/db/auth alone.
//
// - `pruneRateLimitHits`: every hit older than the longest window any bucket counts in, in every bucket. A hit that
//   old is outside every bucket's window, so no count changes.
// - `pruneAccountEmails`: every row `sent` or `failed` (its link already cleared) last moved more than
//   ACCOUNT_EMAIL_KEEP_DAYS ago. A row `queued` or `sending` is never deleted: the job, or a person, decides it.
// Each deletes in batches, of rows taken `for update skip locked`: it never waits on a row a live sign-in or outbox
// step holds (so never deadlocks with one), and leaves that row to the next run. Safe to run twice, and beside itself.
// Each returns how many rows it deleted, and nothing else: no bucket key, no address.
import { signInLimits } from '@lzp/config';
import { sql, type SQL } from 'drizzle-orm';
import type { Orm } from '../db.ts';
import { accountEmail, rateLimitHit } from '../schema/auth-only.ts';

/**
 * The longest window any rate-limit bucket counts in: sign-in's hour (config/sign-in.ts), the only buckets so far.
 * `hitRateLimit` refuses a longer one, so the prune can never delete a hit still inside a window: a bucket with a
 * longer window (§13: review links, uploads, AI work) raises this first.
 */
export const RATE_LIMIT_LONGEST_WINDOW_SECONDS = signInLimits.windowSeconds;

/**
 * How long a sent or failed account email is kept, from its last move: 30 days, as long as the server logs that record
 * the same send (§16 Keeping and deleting, §14). Proposed in #323, pending Zeus's answer there.
 */
export const ACCOUNT_EMAIL_KEEP_DAYS = 30;

/** Rows per delete statement: each holds its locks only that long. */
const PRUNE_BATCH = 1000;

export interface PruneOptions {
  /** Rows per delete statement; PRUNE_BATCH by default. */
  readonly batch?: number;
}

/** Deletes `table`'s rows that match `expired`, a batch at a time, skipping rows another transaction holds. */
async function deleteInBatches(
  orm: Orm,
  table: typeof rateLimitHit | typeof accountEmail,
  expired: SQL,
  batch: number,
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const { rowCount } = await orm.execute(
      sql`delete from ${table} where ${table.id} in (select ${table.id} from ${table} where ${expired} limit ${batch} for update skip locked)`,
    );
    deleted += rowCount ?? 0;
    if ((rowCount ?? 0) < batch) return deleted;
  }
}

/** Deletes every rate-limit hit older than RATE_LIMIT_LONGEST_WINDOW_SECONDS, in every bucket; returns the count. */
export function pruneRateLimitHits(
  orm: Orm,
  { batch = PRUNE_BATCH }: PruneOptions = {},
): Promise<number> {
  return deleteInBatches(
    orm,
    rateLimitHit,
    sql`${rateLimitHit.createdAt} <= now() - make_interval(secs => ${RATE_LIMIT_LONGEST_WINDOW_SECONDS})`,
    batch,
  );
}

/** Deletes every sent or failed account email last moved over ACCOUNT_EMAIL_KEEP_DAYS ago; returns the count. */
export function pruneAccountEmails(
  orm: Orm,
  { batch = PRUNE_BATCH }: PruneOptions = {},
): Promise<number> {
  return deleteInBatches(
    orm,
    accountEmail,
    sql`${accountEmail.status} in ('sent', 'failed') and ${accountEmail.updatedAt} <= now() - make_interval(days => ${ACCOUNT_EMAIL_KEEP_DAYS})`,
    batch,
  );
}

// The auth tables' prune (#323, Cerberus F4 on #229 and F1 on #322): sign-in's two tables, lzp_auth's alone, would
// otherwise grow for ever. `hitRateLimit` deletes old hits only in the bucket it counts, so a bucket never hit again
// keeps its rows; and `account_email` keeps an address in every row it ever wrote. The worker runs both steps on a
// timer, through packages/auth, on the auth handle (`AuthDb.db`): exported from @lzp/db/auth alone.
//
// - `pruneRateLimitHits`: every hit older than the longest window any bucket counts in, in every bucket. A hit that
//   old is outside every bucket's window, so no count changes.
// - `pruneAccountEmails`: every row `sent` or `failed` (its link already cleared) last moved more than
//   ACCOUNT_EMAIL_KEEP_DAYS ago. A row `queued` or `sending` is never deleted: the job, or a person, decides it.
// Each deletes in batches and never waits on a bucket a live sign-in holds or a row the outbox holds (so never
// deadlocks with one), and leaves it to the next run. Safe to run twice, and beside itself. Each returns how many rows
// it deleted, and nothing else: no bucket key, no address.
import { signInLimits } from '@lzp/config';
import { sql } from 'drizzle-orm';
import type { Orm } from '../db.ts';
import { accountEmail, rateLimitHit } from '../schema/auth-only.ts';

/**
 * The longest window any rate-limit bucket counts in: sign-in's hour (config/sign-in.ts), the only buckets so far.
 * `hitRateLimit` refuses a longer one, so the prune can never delete a hit still inside a window: a bucket with a
 * longer window (§13: review links, uploads, AI work) raises this first.
 */
export const RATE_LIMIT_LONGEST_WINDOW_SECONDS = signInLimits.windowSeconds;

/**
 * A bucket's advisory lock is keyed (RATE_LIMIT_LOCK, hashtext(bucket)), in `hitRateLimit` and in the prune: two-key
 * locks never meet the migrations' one-key ones.
 */
export const RATE_LIMIT_LOCK = 77;

/**
 * How long a sent or failed account email is kept, from its last move: 30 days, as long as the server logs that record
 * the same send (§16 Keeping and deleting, §14). Proposed in #323, pending Zeus's answer there.
 */
export const ACCOUNT_EMAIL_KEEP_DAYS = 30;

/**
 * Expired hits looked at per statement. Each statement takes at most that many bucket locks, held until it ends:
 * Postgres's shared lock table holds about max_locks_per_transaction (64) per connection, for every session at once.
 */
const RATE_LIMIT_PRUNE_BATCH = 200;

/** Account emails deleted per statement: each holds its row locks only that long. */
const ACCOUNT_EMAIL_PRUNE_BATCH = 1000;

export interface PruneOptions {
  /** Rows per statement; each step has its own default. */
  readonly batch?: number;
}

/**
 * Deletes every rate-limit hit older than RATE_LIMIT_LONGEST_WINDOW_SECONDS, in every bucket; returns the count.
 *
 * lzp_auth holds no UPDATE on `rate_limit_hit`, so no row lock (CI F1). Instead each statement takes a batch of
 * expired hits, tries their buckets' advisory locks (`hitRateLimit`'s), and deletes the expired hits of the buckets it
 * got. A try never waits, and a bucket it got has no `hitRateLimit` in flight, so no row the prune deletes is held by
 * another transaction: it waits on nothing, so it can't deadlock with a sign-in, or with another prune (which can't
 * get the same bucket). A bucket a sign-in holds is left for the next statement or run; if a whole batch is held, the
 * run ends there and the next run carries on.
 */
export async function pruneRateLimitHits(
  orm: Orm,
  { batch = RATE_LIMIT_PRUNE_BATCH }: PruneOptions = {},
): Promise<number> {
  const expired = sql`created_at <= now() - make_interval(secs => ${RATE_LIMIT_LONGEST_WINDOW_SECONDS})`;
  let total = 0;
  for (;;) {
    // `mine` calls a volatile function, so Postgres neither inlines it nor pushes its filter below the `distinct`: each
    // bucket of the batch is tried once.
    const { rows } = await orm.execute<{ looked: number; deleted: number }>(sql`
      with expired_hits as materialized (
        select bucket from ${rateLimitHit} where ${expired} limit ${batch}
      ), mine as materialized (
        select bucket from (select distinct bucket from expired_hits) buckets
        where pg_try_advisory_xact_lock(${RATE_LIMIT_LOCK}, hashtext(bucket))
      ), gone as (
        delete from ${rateLimitHit} where bucket in (select bucket from mine) and ${expired} returning 1
      )
      select (select count(*) from expired_hits)::int as looked, (select count(*) from gone)::int as deleted`);
    const looked = rows[0]?.looked ?? 0;
    const deleted = rows[0]?.deleted ?? 0;
    total += deleted;
    if (looked < batch || deleted === 0) return total;
  }
}

/**
 * Deletes every sent or failed account email last moved over ACCOUNT_EMAIL_KEEP_DAYS ago; returns the count. Its rows
 * are taken `for update skip locked` (lzp_auth holds UPDATE and DELETE there): it never waits on a row the outbox
 * holds, and leaves that row to the next run.
 */
export async function pruneAccountEmails(
  orm: Orm,
  { batch = ACCOUNT_EMAIL_PRUNE_BATCH }: PruneOptions = {},
): Promise<number> {
  const expired = sql`${accountEmail.status} in ('sent', 'failed') and ${accountEmail.updatedAt} <= now() - make_interval(days => ${ACCOUNT_EMAIL_KEEP_DAYS})`;
  let total = 0;
  for (;;) {
    const { rowCount } = await orm.execute(
      sql`delete from ${accountEmail} where ${accountEmail.id} in (select ${accountEmail.id} from ${accountEmail} where ${expired} limit ${batch} for update skip locked)`,
    );
    total += rowCount ?? 0;
    if ((rowCount ?? 0) < batch) return total;
  }
}

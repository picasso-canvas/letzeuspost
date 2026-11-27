// The app role's rate limiter (#403, §13 The app's API: rate limits in a Postgres table, for uploads and anything
// that starts AI work). sign-in's `hitRateLimit` (./auth.ts) runs on the auth handle (lzp_auth), on a table the app
// role can't reach; this one runs as lzp_app, inside `db.forWorkspace`, on `workspace_rate_limit_hit`, so row-level
// security keeps each workspace's buckets to itself.
import { and, eq, sql } from 'drizzle-orm';
import { checkedId, type Db, type WorkspaceCtx } from './db.ts';
import { workspaceRateLimitHit } from './schema/rate-limits.ts';

/**
 * The key of a workspace bucket's advisory lock, (WORKSPACE_RATE_LIMIT_LOCK, hashtext(workspace and bucket)). Any
 * fixed number not used by another two-key lock (sign-in's limiter holds 77); two-key locks never meet the
 * migrations' one-key ones.
 */
export const WORKSPACE_RATE_LIMIT_LOCK = 78;

/**
 * Counts a request in the workspace's `bucket` if it holds fewer than `limit` requests from the last `windowSeconds`,
 * and says whether it did: false means refused. A sliding window, like sign-in's: the bucket's lock makes two
 * requests at once take turns, so neither sees the other's count before it is written, and the bucket's hits older
 * than the window are deleted in the same transaction, so a bucket never holds more than `limit` rows and needs no
 * prune. Times are the database's, the one clock every request shares.
 */
export async function hitWorkspaceRateLimit(
  db: Db,
  ctx: WorkspaceCtx,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      'hitWorkspaceRateLimit: the limit must be a whole number of requests, 1 or more',
    );
  }
  if (!(Number.isFinite(windowSeconds) && windowSeconds > 0)) {
    throw new Error('hitWorkspaceRateLimit: the window must be a number of seconds, more than 0');
  }
  const workspaceId = checkedId('workspace', ctx.workspaceId);
  return db.forWorkspace(ctx).transaction(async (tx) => {
    const inBucket = and(
      eq(workspaceRateLimitHit.workspaceId, workspaceId),
      eq(workspaceRateLimitHit.bucket, bucket),
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(${WORKSPACE_RATE_LIMIT_LOCK}, hashtext(${`${workspaceId}:${bucket}`}))`,
    );
    await tx
      .delete(workspaceRateLimitHit)
      .where(
        and(
          inBucket,
          sql`${workspaceRateLimitHit.createdAt} <= now() - make_interval(secs => ${windowSeconds})`,
        ),
      );
    const [counted] = await tx
      .select({ hits: sql<number>`count(*)::int` })
      .from(workspaceRateLimitHit)
      .where(inBucket);
    if ((counted?.hits ?? 0) >= limit) return false;
    await tx.insert(workspaceRateLimitHit).values({ workspaceId, bucket });
    return true;
  });
}

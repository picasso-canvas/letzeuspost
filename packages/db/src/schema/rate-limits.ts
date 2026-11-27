// The app role's rate-limit log (#403, §13 The app's API: "Rate limits live in a Postgres table … sign-in, review
// links, uploads, and anything that starts AI work"). sign-in's log (`rate_limit_hit`, ./auth-only.ts) is lzp_auth's
// alone, and holds no workspace; this one is a workspace's, under §13's policy, so the app role (lzp_app) counts its
// own workspace's hits inside `db.forWorkspace` and sees no other's. One row per allowed request in a bucket.
//
// Written by hand in ../../migrations/0010_workspace_rate_limit.sql (§13 A4). Change both together. The grant lives
// only there: lzp_app reads, adds and deletes hits, and changes none.
import { sql } from 'drizzle-orm';
import { index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspace } from './accounts.ts';

const scope = sql.raw("workspace_id = current_setting('app.workspace_id')::uuid");

export const workspaceRateLimitHit = pgTable(
  'workspace_rate_limit_hit',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    /** What is limited, and for whom, inside the workspace: `uploads:<user id>`. Ids only, never a name or address. */
    bucket: text('bucket').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('workspace_rate_limit_hit_workspace_id_bucket_created_at_idx').on(
      t.workspaceId,
      t.bucket,
      t.createdAt,
    ),
    // §13's policy, as §13 writes it.
    pgPolicy('workspace_scope', { for: 'all', using: scope, withCheck: scope }),
  ],
);

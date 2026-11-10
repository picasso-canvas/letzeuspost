// `@lzp/db/auth`: the auth-only export (Q5, Zeus and Athena, 2026-11-07). Only packages/auth may import it; the lint
// rule `lzp/no-raw-db-client` refuses it anywhere else.
//
// - `db` is Better Auth's handle, for its drizzle adapter: the app role with nothing set. It reaches Better Auth's
//   global tables (user, session, account, verification); the workspace tables stay closed to it, because their
//   policies need a workspace or a person set.
// - `forUser(ctx)` runs a unit of work as one signed-in person: Q5's second policy lets it read that person's own
//   memberships and their workspaces, for the workspace switcher and the session's active workspace. Nothing else, and
//   it writes nothing there: writes go through `db.forWorkspace(ctx)`.
import { drizzle } from 'drizzle-orm/node-postgres';
import { checkedId, NOBODY, openPool, scoped, type Orm, type Scoped } from './db.ts';
import * as schema from './schema.ts';

export { schema };
export type { Scoped, Tx } from './db.ts';

/** The signed-in person a call acts for, from the verified session. */
export interface UserCtx {
  readonly userId: string;
}

export interface AuthDb {
  readonly db: Orm;
  forUser: (ctx: UserCtx) => Scoped;
  close: () => Promise<void>;
}

/** Better Auth's database: `url` is DATABASE_URL, the app role (config/env.ts). */
export function createAuthDb(url: string): AuthDb {
  const pool = openPool(url);
  const db = drizzle({ client: pool, schema });
  return {
    db,
    forUser: (ctx) => scoped(db, { workspaceId: NOBODY, userId: checkedId('user', ctx.userId) }),
    close: () => pool.end(),
  };
}

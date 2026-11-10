// `@lzp/db/auth`: the auth-only export (Q5, Zeus and Athena, 2026-11-07). Only packages/auth may import it; the lint
// rule `lzp/no-raw-db-client` refuses it anywhere else. Better Auth's tables (user, session, account, verification)
// are exported from here only (#176).
//
// - `db` is Better Auth's handle, for its drizzle adapter. It runs as lzp_auth, the role that holds those four tables
//   (#176): its pool is its own, and each new connection switches to that role before its first query. lzp_app only
//   may switch to lzp_auth, never inherits it, and this file is the only one that switches (no-role-switch.test.ts).
//   The workspace tables stay closed to it: lzp_auth holds no grant on them.
// - `forUser(ctx)` runs a unit of work as one signed-in person, as lzp_app on a pool that never switches: Q5's second
//   policy lets it read that person's own memberships and their workspaces, for the workspace switcher and the
//   session's active workspace, and the person themself. Nothing else, and it writes nothing there: writes go through
//   `db.forWorkspace(ctx)`.
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
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

/** The role that holds Better Auth's tables (docker/postgres/roles.sh, the migrations). */
const AUTH_ROLE = 'lzp_auth';

/**
 * A pool whose every connection runs as lzp_auth. pg runs a connection's queries in order, and the 'connect' listener
 * runs before the pool hands the new connection out, so the switch comes before any query of Better Auth's. If the
 * switch fails, the connection is closed and leaves the pool. That fails closed: a query that reached it first ran as
 * plain lzp_app, which holds nothing on session, account and verification and can't read "user" with nothing set.
 */
function authPool(url: string): pg.Pool {
  const pool = openPool(url);
  pool.on('connect', (client) => {
    client.query(`SET ROLE ${AUTH_ROLE}`).catch((error: unknown) => {
      console.error(`database: the auth handle could not switch role: ${String(error)}`);
      void client.end();
    });
  });
  return pool;
}

/** Better Auth's database: `url` is DATABASE_URL, the app role's login (config/env.ts). */
export function createAuthDb(url: string): AuthDb {
  const authHandle = authPool(url);
  const userPool = openPool(url);
  const forUserOrm = drizzle({ client: userPool, schema });
  return {
    db: drizzle({ client: authHandle, schema }),
    forUser: (ctx) =>
      scoped(forUserOrm, { workspaceId: NOBODY, userId: checkedId('user', ctx.userId) }),
    close: async () => {
      await Promise.all([authHandle.end(), userPool.end()]);
    },
  };
}

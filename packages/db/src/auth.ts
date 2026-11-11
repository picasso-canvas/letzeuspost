// `@lzp/db/auth`: the auth-only export (Q5, Zeus and Athena, 2026-11-07). Only packages/auth may import it; the lint
// rule `lzp/no-raw-db-client` refuses it anywhere else. Better Auth's tables (user, session, account, verification)
// are exported from here only (#176).
//
// - `db` is Better Auth's handle, for its drizzle adapter. It runs as lzp_auth, the role that holds those four tables
//   (#176): its pool is its own, and each connection takes that role when it opens, before its first query. lzp_app
//   only may switch to lzp_auth, never inherits it, and this file is the only one that switches
//   (no-role-switch.test.ts).
//   The workspace tables stay closed to it: lzp_auth holds no grant on them.
// - `forUser(ctx)` runs a unit of work as one signed-in person, as lzp_app on a pool that never switches: Q5's second
//   policy lets it read that person's own memberships and their workspaces, for the workspace switcher and the
//   session's active workspace, and the person themself. Nothing else, and it writes nothing there: writes go through
//   `db.forWorkspace(ctx)`.
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { checkedId, NOBODY, openPool, scoped, type Orm, type Scoped } from './db.ts';
import * as schema from './schema/accounts.ts';

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
 * A pool whose every connection runs as lzp_auth from the moment it opens (Argus F3, Cerberus F3 on #189). The role
 * goes in the connection's startup options, so Postgres sets it before it accepts the connection: a connection of this
 * pool never exists as plain lzp_app, and its session default is lzp_auth, which RESET ROLE and DISCARD ALL return to.
 * If the login may not take the role, Postgres refuses the connection, and every query that waited for it is refused
 * with that error. The option is set on the URL, not beside it, because pg lets the URL's own `options` override one
 * given beside it.
 */
function authPool(url: string): pg.Pool {
  return openPool(authUrl(url));
}

/** A role in startup options, as `-c role=…` or `--role=…`, any case (Postgres's setting names are). */
const ROLE_OPTION = /(?:-c|--)\s*role\s*=/i;

/**
 * The auth handle's URL: DATABASE_URL with the role added after the startup options already in it (a
 * `statement_timeout`, say), so none is lost (Argus F2, Cerberus F2 on #189). A URL whose options set a role already,
 * or that has `options` twice (pg reads only the last), is refused: which role a connection ends up with must not
 * depend on the order Postgres reads them in.
 */
export function authUrl(url: string): string {
  const withRole = new URL(url);
  const given = withRole.searchParams.getAll('options');
  if (given.length > 1) throw new Error('database: refused: DATABASE_URL has options twice');
  const [options] = given;
  if (options !== undefined && ROLE_OPTION.test(options)) {
    throw new Error(
      "database: refused: DATABASE_URL's options set a role; the auth handle sets its own",
    );
  }
  const role = `-c role=${AUTH_ROLE}`;
  withRole.searchParams.set('options', options === undefined ? role : `${options} ${role}`);
  return withRole.href;
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

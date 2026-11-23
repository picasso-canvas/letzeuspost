// The scoped helper (§13 Keeping workspaces apart, the tenant-isolation skill, #71): the only way the app reads or
// writes workspace data. Each unit of work runs in a transaction that first sets the workspace with
// `set_config(…, true)`, so it lasts only for that transaction and never reaches the next request on the same pooled
// connection. Row-level security then filters every read and refuses every write outside that workspace, even for a
// query that forgets the filter. The raw client stays in this package: the app gets `forWorkspace`, `ping` and `close`.
import { sql, type SQL } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { z } from 'zod';
import * as schema from './schema/accounts.ts';

export type Orm = NodePgDatabase<typeof schema>;

/** A unit of work's transaction: every statement in it runs with the workspace (or the person) already set. */
export type Tx = Parameters<Parameters<Orm['transaction']>[0]>[0];

/** The workspace a call acts for. It comes from the signed-in session or a job's payload, never from a request. */
export interface WorkspaceCtx {
  readonly workspaceId: string;
}

export interface Scoped {
  /** Runs `work` in one transaction, with the setting in place before its first statement. */
  transaction: <T>(work: (tx: Tx) => Promise<T>) => Promise<T>;
}

export interface Db {
  forWorkspace: (ctx: WorkspaceCtx) => Scoped;
  /** For the health route: resolves once the database answers. */
  ping: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * The id the helpers give the setting they don't scope by, so every policy can read both settings and the other one
 * matches no row. `uuidv7()` never returns it, and the helpers refuse it as a workspace or person.
 */
export const NOBODY = '00000000-0000-0000-0000-000000000000';

const uuidv7 = z.uuidv7();

/** Every id in this database is a UUIDv7 (§13); anything else is refused before it reaches Postgres. */
export function checkedId(kind: 'workspace' | 'user', id: string): string {
  if (!uuidv7.safeParse(id).success) throw new Error(`not a ${kind} id: expected a UUIDv7`);
  return id;
}

/** The role a statement runs as, and the role its connection logged in as. */
type RoleRow = { who: string; login: string };

/** The connection's roles from a statement that selects them, or why there's no answer. */
async function connectionRoles(tx: Tx, statement: SQL): Promise<Partial<RoleRow>> {
  const { rows } = await tx.execute<RoleRow>(statement);
  return rows[0] ?? {};
}

/**
 * A unit of work with both settings the policies read set first, for this transaction only. It runs only as the role
 * the connection logged in as (lzp_app), checked twice:
 * - before the work: a pooled connection that something switched to another role (lzp_auth, by SQL injected into an
 *   earlier query, say) is refused, so the switch can't reach the next request on that connection (Cerberus F4 on
 *   #189);
 * - after it: work that switched role inside its own transaction (by injected SQL, for the transaction or the session)
 *   has its result refused, and the transaction rolls back with everything it wrote and the switch itself (Cerberus F1
 *   on #189).
 * Its limit: work that switches, reads and switches back ends as lzp_app, and gets past the second check. Postgres
 * can't be asked to refuse the switch itself: an event trigger never sees a role switch, and Postgres allows one by
 * the session's login, so only a login that may not take lzp_auth stops it (#195's notes). Parameterised queries
 * (Drizzle) keep the SQL out in the first place.
 * Only the auth handle's own pool runs as another role (auth.ts), and it never comes here.
 */
export function scoped(orm: Orm, settings: { workspaceId: string; userId: string }): Scoped {
  return {
    transaction: (work) =>
      orm.transaction(async (tx) => {
        const before = await connectionRoles(
          tx,
          sql`select current_user as who, session_user as login, set_config('app.workspace_id', ${settings.workspaceId}, true), set_config('app.user_id', ${settings.userId}, true)`,
        );
        if (before.who === undefined || before.who !== before.login) {
          throw new Error(
            `database: refused: this connection runs as ${before.who ?? 'an unknown role'}, not ${before.login ?? 'its login'}`,
          );
        }
        const result = await work(tx);
        const after = await connectionRoles(tx, sql`select current_user as who`);
        if (after.who === undefined || after.who !== before.login) {
          throw new Error(
            `database: refused: the work switched this connection to ${after.who ?? 'an unknown role'}, not ${before.login}`,
          );
        }
        return result;
      }),
  };
}

/** How long the database gets before the app gives up on it (Cerberus on #208, #217). */
export interface Limits {
  /** To open a connection, and to wait for a free one when all are busy (pg's `connectionTimeoutMillis`). */
  readonly connectMs: number;
  /** For one statement; Postgres cancels it after that (`statement_timeout`). */
  readonly statementMs: number;
  /** For the health route's ping to be answered, the route's own 3 s. */
  readonly pingMs: number;
}

export const LIMITS: Limits = { connectMs: 5_000, statementMs: 10_000, pingMs: 3_000 };

/**
 * A pool on `url`, with `limits`, so a database that hangs can't pile up connections or waiting queries:
 * - opening a connection, or waiting for a free one, gives up after `connectMs`;
 * - Postgres cancels a statement after `statementMs`. The cancel comes back as the query's error, so the connection
 *   goes back to the pool in order: a transaction rolls back first, as for any other error. It is a default: a statement
 *   limit `url` sets already wins (`withStatementLimit`).
 * The pool sets no client-side `query_timeout`: pg would refuse the query but leave its connection waiting for the
 * answer, and the pool hands that connection, mid-query, to the next request (still inside a transaction that never
 * rolled back, which the next request's commit would commit); Drizzle never gives back one whose `begin` timed out.
 * Only the ping has one (`dbOnPool`): `pool.query` drops a connection whose query failed.
 * A pooled connection that fails while idle (Postgres restarting) is logged, not left to crash the process; pg drops
 * it and opens a new one for the next query.
 */
export function openPool(url: string, limits: Limits = LIMITS): pg.Pool {
  const pool = new pg.Pool({
    connectionString: withStatementLimit(url, limits.statementMs),
    connectionTimeoutMillis: limits.connectMs,
  });
  pool.on('error', (error) => {
    console.error(`database: an idle connection failed: ${error.message}`);
  });
  return pool;
}

/**
 * `url` with the statement limit `ms` at the front of its startup options (CI F1 on #217). Postgres applies the
 * startup options in order, then each startup parameter, so a limit the URL sets itself, in its options or as a
 * `statement_timeout` parameter (pg sends that one as a parameter), comes later and wins; so does any other setting
 * there, the auth handle's role among them (auth.ts). pg reads only the last `options` in a URL, so that is the one kept.
 */
function withStatementLimit(url: string, ms: number): string {
  const withLimit = new URL(url);
  const given = withLimit.searchParams.getAll('options').at(-1);
  const limit = `-c statement_timeout=${String(ms)}`;
  withLimit.searchParams.set('options', given === undefined ? limit : `${limit} ${given}`);
  return withLimit.href;
}

/**
 * The ping: `select 1`, refused after `pingMs` even when the database never answers, and its connection dropped, so a
 * hung database costs the pool no connection per health check (pg reads `query_timeout` on a query too; its types
 * leave it out of QueryConfig, so the object isn't written inline).
 */
function pingQuery(limits: Pick<Limits, 'pingMs'>): pg.QueryConfig {
  const query = { text: 'select 1', query_timeout: limits.pingMs };
  return query;
}

/** The helper on a given pool (the tests use a one-connection pool to watch a connection being reused). */
export function dbOnPool(pool: pg.Pool, limits: Pick<Limits, 'pingMs'> = LIMITS): Db {
  const orm = drizzle({ client: pool, schema });
  const ping = pingQuery(limits);
  return {
    forWorkspace: (ctx) =>
      scoped(orm, { workspaceId: checkedId('workspace', ctx.workspaceId), userId: NOBODY }),
    ping: async () => {
      await pool.query(ping);
    },
    close: () => pool.end(),
  };
}

/** The app's database: `url` is DATABASE_URL, the app role (config/env.ts). */
export function createDb(url: string): Db {
  return dbOnPool(openPool(url));
}

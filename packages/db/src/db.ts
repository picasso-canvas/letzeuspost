// The scoped helper (§13 Keeping workspaces apart, the tenant-isolation skill, #71): the only way the app reads or
// writes workspace data. Each unit of work runs in a transaction that first sets the workspace with
// `set_config(…, true)`, so it lasts only for that transaction and never reaches the next request on the same pooled
// connection. Row-level security then filters every read and refuses every write outside that workspace, even for a
// query that forgets the filter. The raw client stays in this package: the app gets `forWorkspace`, `ping` and `close`.
import { sql, type SQL } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { z } from 'zod';
import * as schema from './schema.ts';

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
interface RoleRow {
  who: string;
  login: string;
}

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

/**
 * A pool on `url`. A pooled connection that fails while idle (Postgres restarting) is logged, not left to crash the
 * process; pg drops it and opens a new one for the next query.
 */
export function openPool(url: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: url });
  pool.on('error', (error) => {
    console.error(`database: an idle connection failed: ${error.message}`);
  });
  return pool;
}

/** The helper on a given pool (the tests use a one-connection pool to watch a connection being reused). */
export function dbOnPool(pool: pg.Pool): Db {
  const orm = drizzle({ client: pool, schema });
  return {
    forWorkspace: (ctx) =>
      scoped(orm, { workspaceId: checkedId('workspace', ctx.workspaceId), userId: NOBODY }),
    ping: async () => {
      await pool.query('select 1');
    },
    close: () => pool.end(),
  };
}

/** The app's database: `url` is DATABASE_URL, the app role (config/env.ts). */
export function createDb(url: string): Db {
  return dbOnPool(openPool(url));
}

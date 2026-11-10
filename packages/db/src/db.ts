// The scoped helper (§13 Keeping workspaces apart, the tenant-isolation skill, #71): the only way the app reads or
// writes workspace data. Each unit of work runs in a transaction that first sets the workspace with
// `set_config(…, true)`, so it lasts only for that transaction and never reaches the next request on the same pooled
// connection. Row-level security then filters every read and refuses every write outside that workspace, even for a
// query that forgets the filter. The raw client stays in this package: the app gets `forWorkspace`, `ping` and `close`.
import { sql } from 'drizzle-orm';
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

/** A unit of work with both settings the policies read set first, for this transaction only. */
export function scoped(orm: Orm, settings: { workspaceId: string; userId: string }): Scoped {
  return {
    transaction: (work) =>
      orm.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.workspace_id', ${settings.workspaceId}, true), set_config('app.user_id', ${settings.userId}, true)`,
        );
        return work(tx);
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

// The pool's statement limit against real Postgres (Cerberus on #208, #217): Postgres cancels a query that runs past
// it, and the connection goes back to the pool ready for the next one, in or out of a transaction. Runs in
// `pnpm check:services` and CI's `services` job (the `.int.test.ts` name).
import { randomUUIDv7 } from 'node:crypto';
import { loadEnv } from '@lzp/config';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { dbOnPool, LIMITS, openPool } from './db.ts';

const { DATABASE_URL: appUrl } = loadEnv('worker');
const pool = openPool(appUrl, { ...LIMITS, statementMs: 100 });
const db = dbOnPool(pool);

afterAll(async () => {
  await db.close();
});

/** Postgres's code for "canceling statement due to statement timeout". */
const CANCELLED = '57014';

/** The Postgres error code the promise was refused with (Drizzle puts the driver's error in `cause`). */
async function refusalCode(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    let current: unknown = error;
    while (current instanceof Error) {
      if ('code' in current) return current.code;
      current = current.cause;
    }
    return error;
  }
  throw new Error('expected Postgres to cancel this, and it did not');
}

describe('the pool openPool builds, against Postgres', () => {
  // One more than the pool holds, one after another: a connection kept by a timed-out query would leave the last one
  // waiting for a free connection until the connect limit refused it.
  const runs = () => Array.from({ length: pool.options.max + 1 }, (_, run) => run);

  it('has Postgres cancel a query past the statement limit, and gives its connection back', async () => {
    for (const run of runs()) {
      expect(await refusalCode(pool.query('select pg_sleep(5)')), `run ${String(run)}`).toBe(
        CANCELLED,
      );
    }
    const { rows } = await pool.query<{ one: number }>('select 1 as one');
    expect(rows).toEqual([{ one: 1 }]);
    expect(pool.waitingCount).toBe(0);
  });

  it('rolls back a transaction whose query was cancelled, and gives its connection back outside it', async () => {
    const workspaceId = randomUUIDv7();
    const scopedDb = db.forWorkspace({ workspaceId });
    for (const run of runs()) {
      const slow = scopedDb.transaction((tx) => tx.execute(sql`select pg_sleep(5)`));
      expect(await refusalCode(slow), `run ${String(run)}`).toBe(CANCELLED);
    }
    expect(pool.idleCount).toBe(pool.totalCount);
    // Every connection is out of its transaction: none still has the workspace set.
    const after = await Promise.all(
      Array.from({ length: pool.totalCount }, () =>
        pool.query<{ ws: string | null }>(
          "select nullif(current_setting('app.workspace_id', true), '') as ws",
        ),
      ),
    );
    expect(after.map(({ rows }) => rows[0]?.ws ?? null)).toEqual(after.map(() => null));
    const inside = await scopedDb.transaction(async (tx) => {
      const { rows } = await tx.execute<{ ws: string }>(
        sql`select current_setting('app.workspace_id') as ws`,
      );
      return rows[0]?.ws;
    });
    expect(inside).toBe(workspaceId);
  });
});

describe("the pool's statement limit beside DATABASE_URL's own (CI F1 on #217)", () => {
  /** The statement limit a connection of a pool on `url` runs with. */
  async function statementLimit(url: string): Promise<string | undefined> {
    const own = openPool(url);
    try {
      const { rows } = await own.query<{ limit: string }>(
        "select current_setting('statement_timeout') as limit",
      );
      return rows[0]?.limit;
    } finally {
      await own.end();
    }
  }

  it('gives a connection the default when DATABASE_URL sets none', async () => {
    expect(await statementLimit(appUrl)).toBe(`${String(LIMITS.statementMs / 1000)}s`);
  });

  it.each([
    ['in its startup options', 'options', '-c statement_timeout=4321'],
    ['as a parameter of its own', 'statement_timeout', '4321'],
  ])('keeps a statement limit DATABASE_URL sets %s', async (_label, name, value) => {
    const url = new URL(appUrl);
    url.searchParams.set(name, value);
    expect(await statementLimit(url.href)).toBe('4321ms');
  });
});

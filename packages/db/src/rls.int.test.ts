// Keeping workspaces apart in Postgres (§13, the tenant-isolation skill, #71): the helper sets the workspace in every
// transaction, row-level security filters every read and refuses every write outside it, and the app role can't get
// around it. Runs against real Postgres in `pnpm check:services` and CI's `services` job (docker/compose.yml's roles:
// lzp_owner runs the migrations, lzp_app is the app). Every row here is made for this run and removed after it, so the
// file can share the database with other test files.
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@lzp/config';
import { and, eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthDb, type AuthDb } from './auth.ts';
import { createDb, dbOnPool, type Db } from './db.ts';
import { migrate } from './migrate.ts';
import { invitation, member, workspace } from './schema.ts';

const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');
const { DATABASE_URL: appUrl } = loadEnv('worker');

/** The Postgres error under whatever wraps it (Drizzle puts the driver's error in `cause`). */
function pgError(error: unknown): { code: string; message: string; constraint?: string } {
  let current: unknown = error;
  while (typeof current === 'object' && current !== null) {
    const { code, message, constraint, cause } = current as Record<string, unknown>;
    if (typeof code === 'string' && typeof message === 'string') {
      return { code, message, ...(typeof constraint === 'string' ? { constraint } : {}) };
    }
    current = cause;
  }
  throw new Error(`not a Postgres error: ${String(error)}`, { cause: error });
}

/** Resolves to the Postgres error the promise was refused with; fails the test if it wasn't refused. */
async function refusal(promise: Promise<unknown>): Promise<ReturnType<typeof pgError>> {
  try {
    await promise;
  } catch (error) {
    return pgError(error);
  }
  throw new Error('expected Postgres to refuse this, and it did not');
}

/** Row-level security refused a write: "new row violates row-level security policy". */
const RLS_REFUSED = '42501';
/** What §13's policy does with no workspace set: the setting is unknown (42704) or empty (22P02). */
const NOT_SET = ['42704', '22P02'];

/**
 * The rows the app role sees in a table with nothing set: none. §13's policy can't read an unset workspace, so Postgres
 * either refuses the query or, where the policy never runs, returns nothing.
 */
async function rowsSeenUnscoped(
  client: { query: (text: string) => Promise<pg.QueryResult> },
  table: string,
): Promise<unknown[]> {
  try {
    return (await client.query(`select * from "${table}"`)).rows;
  } catch (error) {
    expect(NOT_SET).toContain(pgError(error).code);
    return [];
  }
}

const run = randomUUID();
const owner = new pg.Client({ connectionString: ownerUrl });
let db: Db;
let authDb: AuthDb;

/** This run's people and workspaces, made by the owner role (row-level security doesn't apply to the tables' owner). */
const ids = {
  ownerA: '',
  ownerB: '',
  person: '', // an Editor in A and an Admin in B, not in C
  newcomer: '', // in no workspace yet
  a: '',
  b: '',
  c: '', // owned by ownerA
  personInA: '', // the person's membership in A
};

async function insertId(text: string, values: unknown[]): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(`${text} returning id`, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`nothing inserted: ${text}`);
  return id;
}

beforeAll(async () => {
  // Two at once, as two deploys or two test files might: the lock makes the second wait, then find nothing to do.
  await Promise.all([migrate(ownerUrl), migrate(ownerUrl)]);
  await migrate(ownerUrl);

  await owner.connect();
  const person = (label: string) =>
    insertId('insert into "user" (name, email) values ($1, $2)', [
      `${label} ${run}`,
      `${label}-${run}@rls.invalid`,
    ]);
  ids.ownerA = await person('owner-a');
  ids.ownerB = await person('owner-b');
  ids.person = await person('person');
  ids.newcomer = await person('newcomer');
  const space = (label: string) =>
    insertId('insert into workspace (name, slug) values ($1, $2)', [
      `Workspace ${label} ${run}`,
      `${label}-${run}`,
    ]);
  ids.a = await space('a');
  ids.b = await space('b');
  ids.c = await space('c');
  const join = (workspaceId: string, userId: string, role: string) =>
    insertId('insert into member (workspace_id, user_id, role) values ($1, $2, $3)', [
      workspaceId,
      userId,
      role,
    ]);
  await join(ids.a, ids.ownerA, 'owner');
  ids.personInA = await join(ids.a, ids.person, 'editor');
  await join(ids.b, ids.ownerB, 'owner');
  await join(ids.b, ids.person, 'admin');
  await join(ids.c, ids.ownerA, 'owner');
  for (const [workspaceId, inviter] of [
    [ids.a, ids.ownerA],
    [ids.b, ids.ownerB],
  ] as const) {
    await insertId(
      `insert into invitation (workspace_id, email, role, expires_at, inviter_id)
       values ($1, $2, 'editor', now() + interval '7 days', $3)`,
      [workspaceId, `invited-${run}@rls.invalid`, inviter],
    );
  }

  db = createDb(appUrl);
  authDb = createAuthDb(appUrl);
});

afterAll(async () => {
  await db.close();
  await authDb.close();
  // Deleting the workspaces and people removes their members and invitations with them.
  await owner.query('delete from workspace where id = any($1)', [[ids.a, ids.b, ids.c]]);
  await owner.query('delete from "user" where id = any($1)', [
    [ids.ownerA, ids.ownerB, ids.person, ids.newcomer],
  ]);
  await owner.end();
});

describe('the app role', () => {
  it('has no BYPASSRLS, is no superuser, and owns none of the tables', async () => {
    const { rows } = await db.forWorkspace({ workspaceId: ids.a }).transaction((tx) =>
      tx.execute(sql`
        select current_user as who, r.rolbypassrls as bypass, r.rolsuper as super,
               (select count(*)::int from pg_tables t
                 where t.schemaname = 'public' and t.tableowner = current_user) as owned
          from pg_roles r where r.rolname = current_user`),
    );
    expect(rows).toEqual([{ who: 'lzp_app', bypass: false, super: false, owned: 0 }]);
  });

  it('meets row-level security with §13 policy on every workspace table, for reads and writes', async () => {
    const { rows } = await owner.query<{
      table: string;
      key: string;
      rls: boolean;
      owner: string;
      qual: string | null;
      check: string | null;
      cmd: string | null;
    }>(`
      select c.relname as table, k.key, c.relrowsecurity as rls, pg_get_userbyid(c.relowner) as owner,
             p.qual, p.with_check as check, p.cmd
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        join lateral (
          select 'workspace_id' as key
           where exists (select 1 from pg_attribute a
                          where a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped)
          union all select 'id' where c.relname = 'workspace'
        ) k on true
        left join pg_policies p
          on p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'workspace_scope'
       where c.relkind = 'r'
       order by c.relname`);
    // Every table that holds workspace data, today's and every later one's.
    expect(rows.map((row) => row.table)).toEqual(
      expect.arrayContaining(['invitation', 'member', 'workspace']),
    );
    for (const row of rows) {
      const policy = `(${row.key} = (current_setting('app.workspace_id'::text))::uuid)`;
      expect(row, row.table).toEqual({
        table: row.table,
        key: row.key,
        rls: true,
        owner: 'lzp_owner',
        qual: policy,
        check: policy,
        cmd: 'ALL',
      });
    }
  });
});

describe('db.forWorkspace(ctx)', () => {
  it("shows workspace A none of B's rows, even when a query asks for them", async () => {
    const seen = await db.forWorkspace({ workspaceId: ids.a }).transaction(async (tx) => ({
      workspaces: await tx.select({ id: workspace.id }).from(workspace),
      members: await tx
        .select({ id: member.id, workspaceId: member.workspaceId, userId: member.userId })
        .from(member),
      invitations: await tx.select({ workspaceId: invitation.workspaceId }).from(invitation),
      askedForB: await tx.select().from(member).where(eq(member.workspaceId, ids.b)),
      workspaceB: await tx.select().from(workspace).where(eq(workspace.id, ids.b)),
    }));
    expect(seen.workspaces).toEqual([{ id: ids.a }]);
    expect(seen.members.map((row) => row.userId).sort()).toEqual([ids.ownerA, ids.person].sort());
    expect(seen.members.every((row) => row.workspaceId === ids.a)).toBe(true);
    expect(seen.invitations).toEqual([{ workspaceId: ids.a }]);
    expect(seen.askedForB).toEqual([]);
    expect(seen.workspaceB).toEqual([]);
  });

  it("refuses to write a row with B's id while set to A, and changes none of B's rows", async () => {
    const asA = db.forWorkspace({ workspaceId: ids.a });
    expect(
      (
        await refusal(
          asA.transaction((tx) =>
            tx.insert(member).values({ workspaceId: ids.b, userId: ids.newcomer, role: 'viewer' }),
          ),
        )
      ).code,
    ).toBe(RLS_REFUSED);
    expect(
      (
        await refusal(
          asA.transaction((tx) =>
            tx.insert(invitation).values({
              workspaceId: ids.b,
              email: `planted-${run}@rls.invalid`,
              role: 'admin',
              expiresAt: new Date(Date.now() + 86_400_000),
              inviterId: ids.ownerA,
            }),
          ),
        )
      ).code,
    ).toBe(RLS_REFUSED);
    // Moving one of A's rows into B is a write into B.
    expect(
      (
        await refusal(
          asA.transaction((tx) =>
            tx.update(member).set({ workspaceId: ids.b }).where(eq(member.id, ids.personInA)),
          ),
        )
      ).code,
    ).toBe(RLS_REFUSED);
    // A new workspace can only be written with its own id set (the workspace table's key is its id).
    expect(
      (
        await refusal(
          asA.transaction((tx) =>
            tx.insert(workspace).values({ name: `Planted ${run}`, slug: `planted-${run}` }),
          ),
        )
      ).code,
    ).toBe(RLS_REFUSED);

    // Updates and deletes aimed at B's rows find nothing to change ...
    const touched = await asA.transaction(async (tx) => ({
      renamed: await tx
        .update(workspace)
        .set({ name: 'Taken over' })
        .where(eq(workspace.id, ids.b))
        .returning({ id: workspace.id }),
      demoted: await tx
        .update(member)
        .set({ role: 'viewer' })
        .where(eq(member.workspaceId, ids.b))
        .returning({ id: member.id }),
      removed: await tx
        .delete(invitation)
        .where(eq(invitation.workspaceId, ids.b))
        .returning({ id: invitation.id }),
    }));
    expect(touched).toEqual({ renamed: [], demoted: [], removed: [] });
    // ... and B's rows are as they were.
    const b = await owner.query(
      `select (select name from workspace where id = $1) as name,
              (select array_agg(role order by role) from member where workspace_id = $1) as roles,
              (select count(*)::int from invitation where workspace_id = $1) as invitations,
              (select count(*)::int from member where workspace_id = $1 and user_id = $2) as planted`,
      [ids.b, ids.newcomer],
    );
    expect(b.rows).toEqual([
      { name: `Workspace b ${run}`, roles: ['admin', 'owner'], invitations: 1, planted: 0 },
    ]);
  });

  it("doesn't carry the setting over to the next transaction on the same pooled connection", async () => {
    const pool = new pg.Pool({ connectionString: appUrl, max: 1 });
    try {
      const single = dbOnPool(pool);
      const inside = await single.forWorkspace({ workspaceId: ids.a }).transaction(async (tx) => {
        const { rows } = await tx.execute(
          sql`select pg_backend_pid() as pid, current_setting('app.workspace_id') as ws`,
        );
        return rows[0];
      });
      expect(inside?.['ws']).toBe(ids.a);

      const after = await pool.query<{ pid: number; ws: string | null }>(
        "select pg_backend_pid() as pid, current_setting('app.workspace_id', true) as ws",
      );
      expect(after.rows[0]?.pid).toBe(inside?.['pid']); // the same connection, handed out again
      expect(['', null]).toContain(after.rows[0]?.ws);
      expect(await rowsSeenUnscoped(pool, 'member')).toEqual([]);

      // Nor after a unit of work that failed and rolled back.
      await expect(
        single.forWorkspace({ workspaceId: ids.b }).transaction(() => {
          throw new Error('the work failed');
        }),
      ).rejects.toThrow('the work failed');
      const afterFailure = await pool.query<{ ws: string | null }>(
        "select current_setting('app.workspace_id', true) as ws",
      );
      expect(['', null]).toContain(afterFailure.rows[0]?.ws);
      expect(await rowsSeenUnscoped(pool, 'workspace')).toEqual([]);
    } finally {
      await pool.end();
    }
  });

  it('answers ping() for the health route', async () => {
    await expect(db.ping()).resolves.toBeUndefined();
  });
});

describe('the app role with no workspace set', () => {
  it('sees no workspace rows', async () => {
    const fresh = new pg.Client({ connectionString: appUrl });
    await fresh.connect();
    try {
      for (const table of ['workspace', 'member', 'invitation']) {
        expect(await rowsSeenUnscoped(fresh, table), table).toEqual([]);
      }
    } finally {
      await fresh.end();
    }
  });
});

describe('exactly one Owner (§15)', () => {
  it('refuses a second Owner in the same workspace, by a new member or a promotion', async () => {
    const asA = db.forWorkspace({ workspaceId: ids.a });
    const added = await refusal(
      asA.transaction((tx) =>
        tx.insert(member).values({ workspaceId: ids.a, userId: ids.newcomer, role: 'owner' }),
      ),
    );
    expect(added.constraint).toBe('member_one_owner');
    const promoted = await refusal(
      asA.transaction((tx) =>
        tx.update(member).set({ role: 'owner' }).where(eq(member.id, ids.personInA)),
      ),
    );
    expect(promoted.constraint).toBe('member_one_owner');

    // The rule is about the Owner: the same person joins as an Admin, and B keeps its own Owner.
    const joined = await asA.transaction((tx) =>
      tx
        .insert(member)
        .values({ workspaceId: ids.a, userId: ids.newcomer, role: 'admin' })
        .returning({ role: member.role }),
    );
    expect(joined).toEqual([{ role: 'admin' }]);
    const owners = await owner.query(
      "select workspace_id from member where role = 'owner' and workspace_id = any($1) order by workspace_id",
      [[ids.a, ids.b]],
    );
    expect(owners.rows).toEqual(
      [{ workspace_id: ids.a }, { workspace_id: ids.b }].sort((x, y) =>
        x.workspace_id.localeCompare(y.workspace_id),
      ),
    );
  });

  it('refuses a role outside the four of §01', async () => {
    const wrong = await refusal(
      db
        .forWorkspace({ workspaceId: ids.b })
        .transaction((tx) =>
          tx.insert(member).values({ workspaceId: ids.b, userId: ids.newcomer, role: 'member' }),
        ),
    );
    expect(wrong.constraint).toBe('member_role_check');
  });
});

describe("a signed-in person's own workspaces (Q5, through @lzp/db/auth)", () => {
  it('reads their own memberships and those workspaces, and nobody else’s', async () => {
    const seen = await authDb.forUser({ userId: ids.person }).transaction(async (tx) => ({
      members: await tx
        .select({ workspaceId: member.workspaceId, userId: member.userId, role: member.role })
        .from(member),
      workspaces: await tx.select({ id: workspace.id }).from(workspace),
      invitations: await tx.select().from(invitation),
    }));
    expect(seen.members.sort((x, y) => x.role.localeCompare(y.role))).toEqual([
      { workspaceId: ids.b, userId: ids.person, role: 'admin' },
      { workspaceId: ids.a, userId: ids.person, role: 'editor' },
    ]);
    expect(seen.workspaces.map((row) => row.id).sort()).toEqual([ids.a, ids.b].sort());
    expect(seen.invitations).toEqual([]);

    const ownerA = await authDb
      .forUser({ userId: ids.ownerA })
      .transaction((tx) => tx.select({ id: workspace.id }).from(workspace));
    expect(ownerA.map((row) => row.id).sort()).toEqual([ids.a, ids.c].sort());
  });

  it('writes nothing that way', async () => {
    const asPerson = authDb.forUser({ userId: ids.person });
    expect(
      (
        await refusal(
          asPerson.transaction((tx) =>
            tx.insert(member).values({ workspaceId: ids.a, userId: ids.ownerB, role: 'viewer' }),
          ),
        )
      ).code,
    ).toBe(RLS_REFUSED);
    const touched = await asPerson.transaction(async (tx) => ({
      renamed: await tx
        .update(workspace)
        .set({ name: 'Renamed' })
        .where(eq(workspace.id, ids.a))
        .returning({ id: workspace.id }),
      promoted: await tx
        .update(member)
        .set({ role: 'admin' })
        .where(and(eq(member.workspaceId, ids.a), eq(member.userId, ids.person)))
        .returning({ id: member.id }),
      left: await tx
        .delete(member)
        .where(eq(member.userId, ids.person))
        .returning({ id: member.id }),
    }));
    expect(touched).toEqual({ renamed: [], promoted: [], left: [] });
  });
});

// A deliberately broken query, one that drops the workspace filter, fails twice (§13 Keeping workspaces apart, §13 Done
// when): in the app, by the lint rule, and in Postgres, by row-level security.
//
// The lint half: §13's app-side rule is that every query goes through `db.forWorkspace`, and importing the raw
// database client outside packages/db is a lint error (`lzp/no-raw-db-client`). The broken query is linted through
// ESLint's API with the repo's own config, as `pnpm lint` reads it for a file in apps/web; only type information is
// off (the snippet is no file on disk, so the TypeScript project can't hold it), which no rule here needs.
//
// The row-level security half: the same query, filter dropped, run where the app's queries run, in A's unit of work
// as the app role: none of B's rows come back, and none can be changed or made.
import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  emailMessage,
  invitation,
  member,
  workspace,
  type Tx,
} from '../../packages/db/src/index.ts';
import { setUpTenancy, text, type Row, type Tenancy } from './fixtures.ts';
import { REPO_ROOT } from './inventory.ts';

/** Where the snippets are linted as if they were: a server file in apps/web. */
const IN_THE_APP = path.join(REPO_ROOT, 'apps/web/src/server/tenancy-broken-query.ts');

const BROKEN = `import { drizzle } from 'drizzle-orm/node-postgres';
import { invitation } from '@lzp/db';

const db = drizzle(process.env.DATABASE_URL ?? '');

// Every workspace's invitations: no workspace filter, no forWorkspace.
export const invitations = () => db.select().from(invitation);
`;

const THROUGH_THE_HELPER = `import { invitation, type Db, type WorkspaceCtx } from '@lzp/db';

export const invitations = (db: Db, ctx: WorkspaceCtx) =>
  db.forWorkspace(ctx).transaction((tx) => tx.select().from(invitation));
`;

describe('a query that drops the workspace filter: the lint rule', () => {
  const eslint = new ESLint({
    cwd: REPO_ROOT,
    overrideConfig: [tseslint.configs.disableTypeChecked],
  });

  async function lint(code: string) {
    const [result] = await eslint.lintText(code, { filePath: IN_THE_APP });
    if (result === undefined) throw new Error('ESLint gave no result');
    return result.messages;
  }

  it('the repo’s config turns lzp/no-raw-db-client on, as an error, for apps/web', async () => {
    const config = (await eslint.calculateConfigForFile(IN_THE_APP)) as {
      rules?: Record<string, unknown>;
    };
    const setting = config.rules?.['lzp/no-raw-db-client'];
    expect([2, 'error']).toContain(Array.isArray(setting) ? setting[0] : setting);
  });

  it('flags the broken query’s raw client', async () => {
    const messages = await lint(BROKEN);
    expect(messages.filter((each) => each.fatal === true)).toEqual([]);
    const flagged = messages.filter((each) => each.ruleId === 'lzp/no-raw-db-client');
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((each) => each.severity === 2)).toBe(true);
  });

  it('doesn’t flag the same query through forWorkspace (so the flag is about the dropped filter)', async () => {
    const messages = await lint(THROUGH_THE_HELPER);
    expect(messages.filter((each) => each.fatal === true)).toEqual([]);
    expect(messages.filter((each) => each.ruleId === 'lzp/no-raw-db-client')).toEqual([]);
  });
});

/** What one statement in A's unit of work came to: refused by Postgres, or its rows and the count it touched. */
type Outcome = { refused: string } | { rows: Row[]; count: number | null };

/**
 * The two outcomes that keep B's rows from A: Postgres refused the statement for want of a privilege, or for a row
 * the policy won't let in (both are 42501, insufficient privilege); or nothing came back and nothing was touched. A
 * row of B's returned, changed or made, or any other error, is neither.
 */
const REACHED_NOTHING: Outcome[] = [{ refused: '42501' }, { rows: [], count: 0 }];

/** The SQLSTATE under whatever wraps the driver's error (Drizzle puts it in `cause`), if there is one. */
function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  while (typeof current === 'object' && current !== null) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string') return code;
    current = cause;
  }
  return undefined;
}

describe('a query that drops the workspace filter: row-level security', () => {
  let t: Tenancy;

  beforeAll(async () => {
    t = await setUpTenancy('broken');
  }, 60_000);

  afterAll(async () => {
    await t.close();
  });

  /** A unit of work in A's workspace: where every query of the app's runs when A is signed in. */
  const inA = <T>(work: (tx: Tx) => Promise<T>) => t.app.forWorkspace(t.a.ctx).transaction(work);

  it('returns none of B’s rows to A’s unit of work, from any workspace table', async () => {
    const rows = await t.app.forWorkspace(t.a.ctx).transaction(async (tx) => ({
      // The broken query, as the app would write it: no `where`.
      invitations: await tx.select().from(invitation),
      emails: await tx.select().from(emailMessage),
      members: await tx.select().from(member),
      workspaces: await tx.select().from(workspace),
      // And as plain SQL.
      raw: (
        await tx.execute<Row>(
          'select workspace_id from invitation union all select workspace_id from email_message union all select workspace_id from member union all select id from workspace',
        )
      ).rows,
    }));
    const a = t.a.ctx.workspaceId;
    // A's own rows are there: the query works, it just can't reach B.
    expect(rows.invitations.map((row) => row.id)).toEqual([t.a.invitation.id]);
    expect(rows.emails.map((row) => row.id)).toEqual([t.a.email.id]);
    expect(rows.workspaces.map((row) => row.id)).toEqual([a]);
    expect(rows.members.map((row) => row.userId).sort()).toEqual([t.a.owner.id, t.both.id].sort());
    expect(rows.members.every((row) => row.workspaceId === a)).toBe(true);
    expect(rows.raw.every((row) => row.workspace_id === a || row.id === a)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(t.b.ctx.workspaceId);
  });

  /**
   * One statement, alone in a unit of work of A's (a refusal ends the transaction it's in): Postgres's refusal, by its
   * code, or what came back and how many rows it touched. A failure that isn't Postgres's is thrown.
   */
  async function tryInA(statement: string): Promise<Outcome> {
    try {
      const result = await inA((tx) => tx.execute<Row>(statement));
      return { rows: result.rows, count: result.rowCount };
    } catch (error) {
      const code = sqlState(error);
      if (code === undefined) throw error;
      return { refused: code };
    }
  }

  it('returns nothing, changes nothing and makes nothing when A’s unit of work names B’s rows', async () => {
    const b = t.b.ctx.workspaceId;
    const planted = `planted-${t.run}@tenancy.invalid`;
    // The broken queries, each naming B's rows, with `returning` so a row reached comes back. Whether the app role
    // holds the grant (it may not delete from email_message at all, 0003) or the policy filters the rows, the answer
    // is the same: refused, or nothing.
    const statements = [
      text`select id from invitation where workspace_id = ${b}`,
      text`select id from email_message where workspace_id = ${b}`,
      text`select user_id from member where workspace_id = ${b}`,
      text`select id from workspace where id = ${b}`,
      text`update invitation set role = 'admin' where workspace_id = ${b} returning id`,
      text`update email_message set to_address = ${planted} where workspace_id = ${b} returning id`,
      text`update workspace set name = ${planted} where id = ${b} returning id`,
      text`delete from invitation where workspace_id = ${b} returning id`,
      text`delete from email_message where workspace_id = ${b} returning id`,
      text`delete from member where workspace_id = ${b} returning user_id`,
      // A row of B's made from A's unit of work: there is nothing to filter, so only a refusal will do.
      text`insert into invitation (workspace_id, email, role, expires_at, inviter_id)
           values (${b}, ${planted}, 'admin', now() + interval '1 day', ${t.a.owner.id}) returning id`,
      text`insert into email_message (workspace_id, template, to_address, data)
           values (${b}, 'email-check', ${planted}, '{}'::jsonb) returning id`,
    ];
    for (const statement of statements) {
      expect(REACHED_NOTHING, statement).toContainEqual(await tryInA(statement));
    }

    // B's rows, read by the owner role (which row-level security doesn't bind), are as the fixtures made them: the
    // statements named rows that are there, and none was changed, removed or added.
    expect({
      invitations: await t.asOwner(
        text`select id, email, role from invitation where workspace_id = ${b}`,
      ),
      emails: await t.asOwner(
        text`select id, to_address from email_message where workspace_id = ${b}`,
      ),
      members: await t.asOwner(
        text`select user_id from member where workspace_id = ${b} order by user_id`,
      ),
      workspaces: await t.asOwner(text`select id, name from workspace where id = ${b}`),
      planted: await t.asOwner(
        text`select id from invitation where email = ${planted}
             union all select id from email_message where to_address = ${planted}
             union all select id from workspace where name = ${planted}`,
      ),
    }).toEqual({
      invitations: [{ id: t.b.invitation.id, email: t.b.invitation.email, role: 'editor' }],
      emails: [{ id: t.b.email.id, to_address: t.b.email.to }],
      members: [t.b.owner.id, t.both.id].sort().map((id) => ({ user_id: id })),
      workspaces: [{ id: b, name: t.b.name }],
      planted: [],
    });
  });
});

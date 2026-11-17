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

  it('returns nothing, changes nothing and makes nothing when A’s unit of work names B’s rows', async () => {
    const b = t.b.ctx.workspaceId;
    const reached = await inA<{ read: Row[]; changed: number | null; removed: number | null }>(
      async (tx) => {
        const read = await tx.execute<Row>(
          text`select id from invitation where workspace_id = ${b}
           union all select id from email_message where workspace_id = ${b}
           union all select user_id from member where workspace_id = ${b}
           union all select id from workspace where id = ${b}`,
        );
        const changed = await tx.execute(
          text`update invitation set role = 'admin' where workspace_id = ${b}`,
        );
        const removed = await tx.execute(text`delete from email_message where workspace_id = ${b}`);
        return { read: read.rows, changed: changed.rowCount, removed: removed.rowCount };
      },
    );
    expect(reached).toEqual({ read: [], changed: 0, removed: 0 });

    // A row of B's made from A's unit of work is refused by the policy.
    await expect(
      inA(async (tx) =>
        tx.insert(invitation).values({
          workspaceId: b,
          email: `planted-${t.run}@tenancy.invalid`,
          role: 'admin',
          expiresAt: new Date(Date.now() + 86_400_000),
          inviterId: t.a.owner.id,
        }),
      ),
    ).rejects.toThrow();

    // B's rows, as B sees them, are as the fixtures made them.
    const ofB = await t.app.forWorkspace(t.b.ctx).transaction(async (tx) => ({
      invitations: await tx.select({ id: invitation.id, role: invitation.role }).from(invitation),
      emails: await tx.select({ id: emailMessage.id }).from(emailMessage),
    }));
    expect(ofB).toEqual({
      invitations: [{ id: t.b.invitation.id, role: 'editor' }],
      emails: [{ id: t.b.email.id }],
    });
  });
});

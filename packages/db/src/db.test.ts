// What the scoped helper promises before it ever reaches Postgres (§13 Keeping workspaces apart, #71). Nothing here
// connects: pg's pool opens a connection only for a query, and every case below is refused before one.
import { afterEach, describe, expect, it } from 'vitest';
import * as authModule from './auth.ts';
import { authUrl, createAuthDb } from './auth.ts';
import { createDb, NOBODY, scoped, type Orm } from './db.ts';
import * as index from './index.ts';

const URL = 'postgres://lzp_app:unused@127.0.0.1:1/letzeuspost';
const opened: { close: () => Promise<void> }[] = [];

function open<T extends { close: () => Promise<void> }>(handle: T): T {
  opened.push(handle);
  return handle;
}

afterEach(async () => {
  for (const handle of opened.splice(0)) await handle.close();
});

describe('@lzp/db', () => {
  it('exports no raw client: only the helper, the migrations, the tables and their types', () => {
    expect(Object.keys(index).filter((name) => /pool|client|orm|drizzle|raw/i.test(name))).toEqual(
      [],
    );
  });

  it('exports none of the auth tables: only @lzp/db/auth does, for packages/auth (#176)', () => {
    for (const name of ['user', 'session', 'account', 'verification']) {
      expect(index, name).not.toHaveProperty(name);
      expect(authModule.schema, name).toHaveProperty(name);
    }
    expect(index).toEqual(
      expect.objectContaining({
        workspace: authModule.schema.workspace,
        member: authModule.schema.member,
        invitation: authModule.schema.invitation,
      }),
    );
  });

  it('hands the app the scoped helper, a ping for the health route and close, nothing else', () => {
    expect(Object.keys(open(createDb(URL))).sort()).toEqual(['close', 'forWorkspace', 'ping']);
  });
});

describe('db.forWorkspace(ctx)', () => {
  it.each([
    ['an empty id', ''],
    ['not an id', 'workspace-a'],
    ['an id with SQL in it', "019a6c3e-8f2b-7c4d-9e1f-0123456789ab'; drop table member; --"],
    ['the nil id, which the helpers use to match nothing', '00000000-0000-0000-0000-000000000000'],
    ['a UUIDv4, which no workspace has (§13: UUIDv7)', 'f47ac10b-58cc-4372-a567-0e02b2c3d479'],
  ])('refuses %s before any query', (_label, workspaceId) => {
    const db = open(createDb(URL));
    expect(() => db.forWorkspace({ workspaceId })).toThrow(/workspace id/);
  });

  it('accepts a UUIDv7', () => {
    const db = open(createDb(URL));
    expect(() =>
      db.forWorkspace({ workspaceId: '019a6c3e-8f2b-7c4d-9e1f-0123456789ab' }),
    ).not.toThrow();
  });
});

describe('scoped(): a unit of work that switches role (Cerberus F1 on #189)', () => {
  // A stand-in for Postgres's transaction, answering `current_user` and `session_user` as a connection logged in as
  // lzp_app would; the work changes `state.who` as a role switch inside the transaction would. rls.int.test.ts does
  // the same against real Postgres.
  function fakeOrm(state: { who: string; statements: number }): Orm {
    const tx = {
      execute: () => {
        state.statements += 1;
        return Promise.resolve({ rows: [{ who: state.who, login: 'lzp_app' }] });
      },
    };
    return {
      transaction: (work: (t: typeof tx) => Promise<unknown>) => work(tx),
    } as unknown as Orm;
  }
  const ctx = { workspaceId: '019a6c3e-8f2b-7c4d-9e1f-0123456789ab', userId: NOBODY };

  it("returns the work's result when the work ends as lzp_app", async () => {
    const state = { who: 'lzp_app', statements: 0 };
    await expect(
      scoped(fakeOrm(state), ctx).transaction(() => Promise.resolve('rows')),
    ).resolves.toBe('rows');
    expect(state.statements).toBe(2); // the setup, then the check after the work
  });

  it("refuses the work's result when the work switched to another role", async () => {
    const state = { who: 'lzp_app', statements: 0 };
    const switched = scoped(fakeOrm(state), ctx).transaction(() => {
      state.who = 'lzp_auth';
      return Promise.resolve('the sessions table');
    });
    await expect(switched).rejects.toThrow(
      'refused: the work switched this connection to lzp_auth, not lzp_app',
    );
  });

  it('refuses before the work when the connection came switched already', async () => {
    const state = { who: 'lzp_auth', statements: 0 };
    let ran = false;
    const work = () => {
      ran = true;
      return Promise.resolve();
    };
    await expect(scoped(fakeOrm(state), ctx).transaction(work)).rejects.toThrow(
      'refused: this connection runs as lzp_auth, not lzp_app',
    );
    expect(ran).toBe(false);
  });
});

describe("@lzp/db/auth's handle URL (Argus F2 and Cerberus F2 on #189)", () => {
  const roleOption = (url: string) => new globalThis.URL(url).searchParams.getAll('options');
  const asAuth = ['-c', 'role=lzp_auth'].join(' ');

  it('gives the role in the startup options of a URL that has none', () => {
    expect(roleOption(authUrl(URL))).toEqual([asAuth]);
  });

  it('keeps the options already in the URL, and adds the role after them', () => {
    const timeout =
      'postgres://lzp_app:pw@db/x?options=-c%20statement_timeout%3D5000&sslmode=disable';
    const url = new globalThis.URL(authUrl(timeout));
    expect(url.searchParams.getAll('options')).toEqual([`-c statement_timeout=5000 ${asAuth}`]);
    expect(url.searchParams.get('sslmode')).toBe('disable');
    expect(`${url.username}:${url.password}@${url.host}${url.pathname}`).toBe('lzp_app:pw@db/x');
  });

  it.each([
    ['a role of its own', `options=${['-c', 'role%3Dlzp_owner'].join('%20')}`],
    [
      'a role, in capitals and with a + for the space',
      `options=${['-c', 'ROLE%3Dlzp_owner'].join('+')}`,
    ],
    ['a role, the long way', `options=${['--', 'role=lzp_owner'].join('')}`],
    ['options twice, which pg reads only the last of', 'options=-c%20a%3D1&options=-c%20b%3D2'],
  ])('refuses a URL whose options have %s', (_label, query) => {
    expect(() => authUrl(`postgres://lzp_app:pw@db/x?${query}`)).toThrow(/options/);
  });
});

describe('@lzp/db/auth forUser(ctx)', () => {
  it.each([
    ['an empty id', ''],
    ['the nil id', '00000000-0000-0000-0000-000000000000'],
    ['not an id', "' or true --"],
  ])('refuses %s before any query', (_label, userId) => {
    const authDb = open(createAuthDb(URL));
    expect(() => authDb.forUser({ userId })).toThrow(/user id/);
  });
});

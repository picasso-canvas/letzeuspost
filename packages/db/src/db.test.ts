// What the scoped helper promises before it ever reaches Postgres (§13 Keeping workspaces apart, #71). Nothing here
// connects: pg's pool opens a connection only for a query, and every case below is refused before one.
import { afterEach, describe, expect, it } from 'vitest';
import * as authModule from './auth.ts';
import { createAuthDb } from './auth.ts';
import { createDb } from './db.ts';
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

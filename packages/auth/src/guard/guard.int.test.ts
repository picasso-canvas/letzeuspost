// The guard on Postgres (#79), in `pnpm check:services` and CI's `services` job: a real sign-in through packages/auth's
// route handler (the link from the account emails' outbox, as server.int.test.ts does it), then the guard on that
// session: the workspace it opens in, switching, refusing a workspace the person isn't in, and sign-out ending the
// session in the database. Every person, workspace and row is this run's, made and removed here.
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@lzp/config';
import { createDb, installJobs, member, migrate, workspace, type Db } from '@lzp/db';
import { createAuthDb, schema, type AuthDb } from '@lzp/db/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthServer, type AuthServer } from '../server.ts';
import { signInBucket } from '../sign-in.ts';
import { createGuard, type Guard } from './guard.ts';

const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');
const { DATABASE_URL: databaseUrl } = loadEnv('worker');
const appUrl = 'http://localhost:3000';

const run = randomUUID();
const secret = `integration-only-${run}`;
const suffix = `-${run}@guard.invalid`;
const nadia = `nadia${suffix}`;
const other = `other${suffix}`;
let server: AuthServer;
let guard: Guard;
let db: Db;
let authDb: AuthDb;
const ids = { nadia: '', other: '', alpha: '', beta: '', gamma: '' };
const buckets = new Set<string>();

/** A text literal for the reads below (plain SQL text on the auth handle); only this file's own values go in. */
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

async function sessionRows(token: string) {
  const result = await authDb.db.execute(
    `select token, active_workspace_id from session where token = ${literal(token)}`,
  );
  return result.rows as { token: string; active_workspace_id: string | null }[];
}

/** Asks for a link from `ip`, runs what the route leaves for after its answer, and opens the link: a session cookie. */
async function signIn(email: string, ip: string): Promise<string> {
  buckets.add(signInBucket(secret, 'ip', ip));
  buckets.add(signInBucket(secret, 'address', email));
  const pending: (() => Promise<void>)[] = [];
  const response = await server.handler(
    new Request(`${appUrl}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: appUrl, 'x-forwarded-for': ip },
      body: JSON.stringify({ email, callbackURL: '/app' }),
    }),
    (task) => {
      pending.push(task);
    },
  );
  expect(response.status).toBe(200);
  for (const task of pending) await task();
  const sent = await authDb.db.execute(
    `select data from account_email where to_address = ${literal(email)} order by created_at desc limit 1`,
  );
  const url = (sent.rows[0] as { data: { url: string } } | undefined)?.data.url ?? '';
  const opened = await server.handler(new Request(url), () => undefined);
  const cookie = opened.headers
    .getSetCookie()
    .find((each) => /session_token=[^;]+/.test(each))
    ?.split(';')[0];
  if (cookie === undefined) throw new Error('not signed in');
  return cookie;
}

const request = (cookie: string) => new Headers({ cookie });

async function tokenOf(cookie: string): Promise<string> {
  const found = await server.getSession(request(cookie));
  if (found === null) throw new Error('no session');
  return found.session.token;
}

beforeAll(async () => {
  await migrate(ownerUrl);
  await installJobs(ownerUrl);
  db = createDb(databaseUrl);
  authDb = createAuthDb(databaseUrl);
  const people = await authDb.db
    .insert(schema.user)
    .values([
      { name: 'Nadia', email: nadia },
      { name: 'Other', email: other },
    ])
    .returning({ id: schema.user.id });
  ids.nadia = people[0]?.id ?? '';
  ids.other = people[1]?.id ?? '';
  server = createAuthServer({
    DATABASE_URL: databaseUrl,
    AUTH_SECRET: secret,
    APP_URL: appUrl,
    LZP_ENV: 'ci',
  });
  guard = createGuard(server);
  // Nadia owns Alpha and is a Viewer in Beta; Gamma is Other's alone.
  const name = (word: string) => `${word} ${run}`;
  ids.alpha = (
    await server.createWorkspace(
      { userId: ids.nadia },
      { name: name('Alpha'), slug: `alpha-${run}` },
    )
  ).id;
  ids.beta = (
    await server.createWorkspace({ userId: ids.other }, { name: name('Beta'), slug: `beta-${run}` })
  ).id;
  ids.gamma = (
    await server.createWorkspace(
      { userId: ids.other },
      { name: name('Gamma'), slug: `gamma-${run}` },
    )
  ).id;
  await db
    .forWorkspace({ workspaceId: ids.beta })
    .transaction((tx) =>
      tx.insert(member).values({ workspaceId: ids.beta, userId: ids.nadia, role: 'viewer' }),
    );
});

afterAll(async () => {
  await server.close();
  for (const id of [ids.alpha, ids.beta, ids.gamma]) {
    // Set to that workspace, the delete reaches it alone (row-level security); its members go with it.
    await db.forWorkspace({ workspaceId: id }).transaction((tx) => tx.delete(workspace));
  }
  // Their sessions and account emails go with them, by the cascade.
  await authDb.db.execute(`delete from "user" where email like ${literal(`%${suffix}`)}`);
  await authDb.db.execute(
    `delete from rate_limit_hit where bucket in (${[...buckets].map(literal).join(', ')})`,
  );
  await authDb.close();
  await db.close();
});

describe('the guard on a real session', () => {
  it('opens a new session in the first of the person’s workspaces, and keeps it on the session', async () => {
    const cookie = await signIn(nadia, '192.0.2.40');
    const opened = await guard.open(request(cookie));
    expect(opened.ok && opened.workspace).toMatchObject({ id: ids.alpha, role: 'owner' });
    expect(opened.ok && opened.workspaces.map((each) => each.id)).toEqual([ids.alpha, ids.beta]);
    expect(await sessionRows(await tokenOf(cookie))).toMatchObject([
      { active_workspace_id: ids.alpha },
    ]);
  });

  it('switches to a workspace the person is in, which then opens first; the role is that workspace’s', async () => {
    const cookie = await signIn(nadia, '192.0.2.41');
    expect((await guard.open(request(cookie))).ok).toBe(true);
    expect(await guard.check(request(cookie), 'make-posts')).toMatchObject({ ok: true });

    expect(await guard.switchTo(request(cookie), ids.beta)).toEqual({ ok: true });
    const opened = await guard.open(request(cookie));
    expect(opened.ok && opened.workspace).toMatchObject({ id: ids.beta, role: 'viewer' });
    // A Viewer sees the workspace and makes no posts (§15).
    expect((await guard.check(request(cookie), 'see-workspace')).ok).toBe(true);
    expect(await guard.check(request(cookie), 'make-posts')).toEqual({
      ok: false,
      refused: 'not-allowed',
    });
  });

  it('refuses a workspace the person isn’t in, and the session keeps the one it had', async () => {
    const cookie = await signIn(nadia, '192.0.2.42');
    await guard.open(request(cookie));
    expect(await guard.switchTo(request(cookie), ids.gamma)).toEqual({
      ok: false,
      refused: 'not-a-member',
    });
    expect(await guard.switchTo(request(cookie), 'not-an-id')).toEqual({
      ok: false,
      refused: 'not-a-member',
    });
    expect(await sessionRows(await tokenOf(cookie))).toMatchObject([
      { active_workspace_id: ids.alpha },
    ]);
  });

  it('refuses a request with no session, or with a cookie no session has', async () => {
    expect(await guard.check(new Headers(), 'see-workspace')).toEqual({
      ok: false,
      refused: 'no-session',
    });
    expect(await guard.open(request(`better-auth.session_token=${randomUUID()}.forged`))).toEqual({
      ok: false,
      refused: 'no-session',
    });
  });

  it('sign-out ends the session in the database: its row is gone and its cookie is refused', async () => {
    const cookie = await signIn(other, '192.0.2.43');
    const token = await tokenOf(cookie);
    expect(await sessionRows(token)).toHaveLength(1);

    const response = await server.handler(
      new Request(`${appUrl}/api/auth/sign-out`, {
        method: 'POST',
        headers: { cookie, origin: appUrl, 'content-type': 'application/json' },
        body: '{}',
      }),
      () => undefined,
    );
    expect(response.status).toBe(200);

    expect(await sessionRows(token)).toEqual([]);
    expect(await server.getSession(request(cookie))).toBeNull();
    expect(await guard.open(request(cookie))).toEqual({ ok: false, refused: 'no-session' });
  });
});

// Email-link sign-in on Postgres (#77), in `pnpm check:services` and CI's `services` job: the route handler with
// Better Auth's drizzle adapter on the auth handle, the account emails' outbox, the rate-limit table, sessions in the
// session table, and workspaces created, listed and made active through `db.forWorkspace` and `forUser` (decision
// (a), 2026-11-10). packages/db's jobs/account-email.int.test.ts checks the outbox's steps, its job and the grants.
//
// packages/auth holds no owner connection: this file reads through the auth handle (lzp_auth, which holds the sign-in
// tables) and writes workspace rows through `db.forWorkspace`. Every person, workspace and row is this run's, made and
// removed here. The `account-email` jobs it queues stay for the worker's handler, which skips a job whose row is gone.
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@lzp/config';
import { createDb, installJobs, member, migrate, workspace, type Db } from '@lzp/db';
import { createAuthDb, schema, type AuthDb } from '@lzp/db/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthServer, type AuthServer } from './server.ts';
import { signInBucket } from './sign-in.ts';

const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('migrate');
const { DATABASE_URL: databaseUrl } = loadEnv('worker');
const appUrl = 'http://localhost:3000';

const run = randomUUID();
const secret = `integration-only-${run}`;
const suffix = `-${run}@sign-in.invalid`;
const known = `nadia${suffix}`;
const other = `other${suffix}`;
const unknown = `stranger${suffix}`;
let server: AuthServer;
let db: Db;
let authDb: AuthDb;
const ids = { known: '', other: '', a: '', b: '' };

/**
 * A text literal for the reads below, which run as plain SQL text on the auth handle (packages/auth can't build
 * parameterised SQL: Drizzle's operators are packages/db's). Only this file's own values go in.
 */
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

async function rows<T>(statement: string): Promise<T[]> {
  const result = await authDb.db.execute(statement);
  return result.rows as T[];
}

async function outbox(to: string) {
  return rows<{ id: string; template: string; data: { url?: string } }>(
    `select id, template, data from account_email where to_address = ${literal(to)} order by created_at`,
  );
}

/** The rate-limit buckets this run counted in, so the end removes those alone (Argus F8). */
const buckets = new Set<string>();

/** What the route hands Next's `after()`, run here once the test has the answer (decision 5). */
const pending: (() => Promise<void>)[] = [];
const afterAnswer = (task: () => Promise<void>) => {
  pending.push(task);
};

async function runAfterAnswer(): Promise<void> {
  for (let task = pending.shift(); task !== undefined; task = pending.shift()) await task();
}

/** Asks for a link and gets the answer; what runs after it is left pending. */
function ask(email: string, ip: string) {
  buckets.add(signInBucket(secret, 'ip', ip));
  buckets.add(signInBucket(secret, 'address', email.trim().toLowerCase()));
  return server.handler(
    new Request(`${appUrl}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: appUrl, 'x-forwarded-for': ip },
      body: JSON.stringify({ email, callbackURL: '/app' }),
    }),
    afterAnswer,
  );
}

async function askForLink(email: string, ip: string) {
  const response = await ask(email, ip);
  await runAfterAnswer();
  return response;
}

function open(url: string) {
  return server.handler(new Request(url), afterAnswer);
}

function sessionCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((cookie) => /session_token=[^;]+/.test(cookie))
    ?.split(';')[0];
}

async function signIn(ip: string): Promise<string> {
  await askForLink(known, ip);
  const url = (await outbox(known)).at(-1)?.data.url ?? '';
  const cookie = sessionCookie(await open(url));
  if (cookie === undefined) throw new Error('not signed in');
  return cookie;
}

beforeAll(async () => {
  await migrate(ownerUrl);
  await installJobs(ownerUrl);
  db = createDb(databaseUrl);
  authDb = createAuthDb(databaseUrl);
  const people = await authDb.db
    .insert(schema.user)
    .values([
      { name: 'Nadia', email: known },
      { name: 'Other', email: other },
    ])
    .returning({ id: schema.user.id });
  ids.known = people[0]?.id ?? '';
  ids.other = people[1]?.id ?? '';
  server = createAuthServer({
    DATABASE_URL: databaseUrl,
    AUTH_SECRET: secret,
    APP_URL: appUrl,
    LZP_ENV: 'ci',
  });
  // B is Other's; A is Other's too, with Nadia an Editor in it.
  ids.a = (await server.createWorkspace({ userId: ids.other }, { name: 'A', slug: `a-${run}` })).id;
  ids.b = (await server.createWorkspace({ userId: ids.other }, { name: 'B', slug: `b-${run}` })).id;
  await db
    .forWorkspace({ workspaceId: ids.a })
    .transaction((tx) =>
      tx.insert(member).values({ workspaceId: ids.a, userId: ids.known, role: 'editor' }),
    );
});

afterAll(async () => {
  const made = await server.listWorkspaces({ userId: ids.known });
  await server.close();
  for (const id of new Set([ids.a, ids.b, ...made.map((space) => space.id)])) {
    // Set to that workspace, the delete reaches it alone (row-level security); its members go with it.
    await db.forWorkspace({ workspaceId: id }).transaction((tx) => tx.delete(workspace));
  }
  // Their sessions and account emails go with them, by the cascade.
  await authDb.db.execute(`delete from "user" where email like ${literal(`%${suffix}`)}`);
  // This run's buckets alone: their names hash its addresses and IPs with its own AUTH_SECRET.
  if (buckets.size > 0) {
    await authDb.db.execute(
      `delete from rate_limit_hit where bucket in (${[...buckets].map(literal).join(', ')})`,
    );
  }
  await authDb.close();
  await db.close();
});

describe('email-link sign-in on Postgres', () => {
  it('answers, then writes one outbox row for a known address, and the link’s token in no other table', async () => {
    const response = await ask(known, '192.0.2.10');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    // Decision 5: nothing is written for the address before the answer.
    expect(await outbox(known)).toEqual([]);
    await runAfterAnswer();
    const [row, ...more] = await outbox(known);
    expect(more).toEqual([]);
    expect(row?.template).toBe('sign-in-link');
    const url = row?.data.url ?? '';
    expect(url.startsWith(`${appUrl}/api/auth/magic-link/verify?`)).toBe(true);
    // The verification row holds the token's hash, never the token.
    const token = new URL(url).searchParams.get('token') ?? '';
    expect(token.length).toBeGreaterThanOrEqual(32);
    const found = await rows<{ hits: number }>(
      `select count(*)::int as hits from verification
        where identifier like ${literal(`%${token}%`)} or value like ${literal(`%${token}%`)}`,
    );
    expect(found).toEqual([{ hits: 0 }]);
  });

  it('signs in once, into a 30-day session stored in Postgres, and refuses the link the second time', async () => {
    await askForLink(known, '192.0.2.11');
    const url = (await outbox(known)).at(-1)?.data.url ?? '';
    const cookie = sessionCookie(await open(url));
    expect(cookie).toBeDefined();
    const session = await server.getSession(new Headers({ cookie: cookie ?? '' }));
    expect(session?.user.id).toBe(ids.known);
    const stored = await authDb.db.query.session.findFirst({
      where: (s, { eq }) => eq(s.token, session?.session.token ?? ''),
    });
    const days = ((stored?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    // Postgres made its id (§13: UUIDv7).
    expect(stored?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const again = await open(url);
    expect(again.headers.get('location')).toContain('error=INVALID_TOKEN');
    expect(sessionCookie(again)).toBeUndefined();
  });

  it('gives an unknown address the same answer and writes nothing for it: no person, link or email', async () => {
    const response = await askForLink(unknown, '192.0.2.12');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    const written = await rows<{ people: number; links: number; emails: number }>(
      `select (select count(*) from "user" where email = ${literal(unknown)})::int as people,
              (select count(*) from verification where value like ${literal(`%${unknown}%`)})::int as links,
              (select count(*) from account_email where to_address = ${literal(unknown)})::int as emails`,
    );
    expect(written).toEqual([{ people: 0, links: 0, emails: 0 }]);
  });

  it('refuses a sixth link for one address within the hour, keeping no plain address or IP', async () => {
    const address = `limited${suffix}`;
    for (let i = 0; i < 5; i += 1) {
      expect((await askForLink(address, '192.0.2.13')).status).toBe(200);
    }
    expect((await askForLink(address, '192.0.2.13')).status).toBe(429);
    const counted = await rows<{ bucket: string }>(
      `select bucket from rate_limit_hit where bucket in (${[...buckets].map(literal).join(', ')})`,
    );
    expect(counted.length).toBeGreaterThan(0);
    expect(counted.map((row) => row.bucket).join(' ')).not.toMatch(/@|192\.0\.2|limited/);
  });
});

describe('workspaces, through db.forWorkspace and forUser', () => {
  it('creates a workspace with an id the app made, its creator its Owner', async () => {
    const { id } = await server.createWorkspace(
      { userId: ids.known },
      { name: 'গল্প ক্যাফে', slug: `golpo-${run}` },
    );
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(await server.listWorkspaces({ userId: ids.known })).toContainEqual({
      id,
      name: 'গল্প ক্যাফে',
      slug: `golpo-${run}`,
      role: 'owner',
    });
  });

  it("lists a person's own workspaces and nobody else's", async () => {
    const theirs = await server.listWorkspaces({ userId: ids.known });
    expect(theirs.map((space) => space.id)).toContain(ids.a);
    expect(theirs.map((space) => space.id)).not.toContain(ids.b);
    expect(theirs.find((space) => space.id === ids.a)?.role).toBe('editor');
    expect(
      (await server.listWorkspaces({ userId: ids.other })).map((space) => space.id).sort(),
    ).toEqual([ids.a, ids.b].sort());
  });

  it('makes a workspace active only for a member: B is refused and the session keeps its choice', async () => {
    const cookie = await signIn('192.0.2.14');
    const signedIn = await server.getSession(new Headers({ cookie }));
    if (signedIn === null) throw new Error('not signed in');
    const session = { token: signedIn.session.token, userId: signedIn.user.id };

    expect(await server.setActiveWorkspace(session, ids.b)).toBe(false);
    expect(await server.setActiveWorkspace(session, 'not-an-id')).toBe(false);
    expect(await server.setActiveWorkspace(session, ids.a)).toBe(true);
    // Another person's membership doesn't open Nadia's session to B.
    expect(await server.setActiveWorkspace({ ...session, userId: ids.other }, ids.b)).toBe(false);

    const stored = await authDb.db.query.session.findFirst({
      where: (s, { eq }) => eq(s.token, session.token),
    });
    expect(stored?.activeWorkspaceId).toBe(ids.a);
    const after = await server.getSession(new Headers({ cookie }));
    expect(after?.session.activeWorkspaceId).toBe(ids.a);
  });

  it("leaves Better Auth's role (lzp_auth) no way into workspace, member or invitation", async () => {
    const reach = await rows<{ table: string; any: boolean }>(
      `select t as table, has_table_privilege(current_user, t, 'SELECT,INSERT,UPDATE,DELETE') as any
         from unnest(array['invitation', 'member', 'workspace']) t order by t`,
    );
    expect(reach).toEqual([
      { table: 'invitation', any: false },
      { table: 'member', any: false },
      { table: 'workspace', any: false },
    ]);
  });
});

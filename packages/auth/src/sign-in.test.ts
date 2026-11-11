// Email-link sign-in (#77, §13 Sign-in and sessions, A5, Q9, §15), through the route handler the web app mounts, on
// Better Auth's memory adapter: the same Better Auth, plugin and hooks as production, without Postgres.
// server.int.test.ts runs the flow again on Postgres, through the auth handle.
import type { DBAdapterInstance } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSignIn,
  SERVED_ENDPOINTS,
  SESSION_DAYS,
  SIGN_IN_LIMITS,
  SIGN_IN_LINK_MINUTES,
  type SignIn,
  type SignInEmail,
} from './sign-in.ts';

const appUrl = 'http://localhost:3000';
const authKey = ['test', 'only', 'key', 'of', 'at', 'least', 'thirty', 'two', 'chars'].join('-');
const known = 'nadia@golpo-cafe.example';
const unknown = 'stranger@nowhere.example';

/** Every bucket's count, and what the limiter said; it allows up to `limit`, as hitRateLimit does in Postgres. */
function countingLimiter() {
  const counts = new Map<string, number>();
  const calls: { bucket: string; limit: number; windowSeconds: number }[] = [];
  return {
    counts,
    calls,
    hit: (bucket: string, limit: number, windowSeconds: number) => {
      calls.push({ bucket, limit, windowSeconds });
      const count = counts.get(bucket) ?? 0;
      if (count >= limit) return Promise.resolve(false);
      counts.set(bucket, count + 1);
      return Promise.resolve(true);
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The memory adapter, except that it refuses a row whose id isn't a UUID, as Postgres's `uuid` columns do (#71's
 * tables): the memory adapter alone takes any text, which hid CI's two `services` failures on 4a5ddd0.
 */
function likePostgresIds(inner: DBAdapterInstance): DBAdapterInstance {
  return (options) => {
    const adapter = inner(options);
    return {
      ...adapter,
      create: (data) => {
        const id: unknown = (data.data as { id?: unknown }).id;
        if (id !== undefined && (typeof id !== 'string' || !UUID.test(id))) {
          return Promise.reject(new Error('invalid input syntax for type uuid'));
        }
        return adapter.create(data);
      },
    };
  };
}

interface Setup {
  signIn: SignIn;
  store: Record<string, Record<string, unknown>[]>;
  queued: SignInEmail[];
  limiter: ReturnType<typeof countingLimiter>;
  userId: string;
}

async function setup(
  options: { secureCookies?: boolean; emailVerified?: boolean } = {},
): Promise<Setup> {
  const store: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const queued: SignInEmail[] = [];
  const limiter = countingLimiter();
  const signIn = createSignIn({
    database: likePostgresIds(memoryAdapter(store)),
    secret: authKey,
    appUrl,
    secureCookies: options.secureCookies ?? false,
    hitRateLimit: limiter.hit,
    queueSignInEmail: (email) => {
      queued.push(email);
      return Promise.resolve();
    },
  });
  const context = await signIn.auth.$context;
  const user = await context.internalAdapter.createUser(
    { email: known, name: 'Nadia', emailVerified: options.emailVerified ?? true },
    { method: 'magic-link' },
  );
  return { signIn, store, queued, limiter, userId: user.id };
}

function askForLink(signIn: SignIn, email: string, headers: Record<string, string> = {}) {
  return signIn.handler(
    new Request(`${appUrl}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: appUrl, ...headers },
      body: JSON.stringify({ email, callbackURL: '/app' }),
    }),
  );
}

function open(signIn: SignIn, url: string) {
  return signIn.handler(new Request(url, { headers: { origin: appUrl } }));
}

/** The session cookie a response sets, if any. */
function sessionCookie(response: Response): string | undefined {
  return response.headers.getSetCookie().find((cookie) => /session_token=[^;]+/.test(cookie));
}

function lastLink(queued: SignInEmail[]): string {
  const email = queued.at(-1);
  if (email === undefined) throw new Error('no sign-in email was queued');
  return email.url;
}

let s: Setup;

beforeEach(async () => {
  s = await setup();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('asking for a sign-in link', () => {
  it('queues one email for an existing account, with a link into the app', async () => {
    const response = await askForLink(s.signIn, known);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    expect(s.queued).toHaveLength(1);
    expect(s.queued[0]).toMatchObject({ userId: s.userId, to: known });
    const link = new URL(lastLink(s.queued));
    expect(link.origin).toBe(appUrl);
    expect(link.pathname).toBe('/api/auth/magic-link/verify');
  });

  it('gives an unknown address the same answer, and creates no account, no link and no email (Q9)', async () => {
    const answers = [await askForLink(s.signIn, known), await askForLink(s.signIn, unknown)];
    const [forKnown, forUnknown] = await Promise.all(
      answers.map(async (r) => ({ status: r.status, body: await r.text() })),
    );
    expect(forUnknown).toEqual(forKnown);
    expect(s.queued.map((email) => email.to)).toEqual([known]);
    expect(s.store['user']?.map((user) => user['email'])).toEqual([known]);
    // Only the known address's link was written.
    expect(s.store['verification']).toHaveLength(1);
  });

  it('stores the link’s token hashed, never as it is in the email', async () => {
    await askForLink(s.signIn, known);
    const token = new URL(lastLink(s.queued)).searchParams.get('token') ?? '';
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(JSON.stringify(s.store['verification'])).not.toContain(token);
  });

  it('matches an address whatever its letter case', async () => {
    await askForLink(s.signIn, 'Nadia@Golpo-Cafe.example');
    expect(s.queued).toHaveLength(1);
  });
});

describe('the link (A5: 10 minutes, single use)', () => {
  it('signs in once, then refuses the same link', async () => {
    await askForLink(s.signIn, known);
    const link = lastLink(s.queued);

    const first = await open(s.signIn, link);
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe(`${appUrl}/app`);
    expect(sessionCookie(first)).toBeDefined();

    const again = await open(s.signIn, link);
    expect(again.status).toBe(302);
    expect(again.headers.get('location')).toContain('error=INVALID_TOKEN');
    expect(sessionCookie(again)).toBeUndefined();
    expect(s.store['session']).toHaveLength(1);
  });

  it('works until its 10 minutes are up', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T09:00:00Z'));
    await askForLink(s.signIn, known);
    vi.setSystemTime(new Date('2026-11-11T09:09:59Z'));
    expect(sessionCookie(await open(s.signIn, lastLink(s.queued)))).toBeDefined();
    expect(SIGN_IN_LINK_MINUTES).toBe(10);
  });

  it('refuses a link older than 10 minutes, and signs no one in', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T09:00:00Z'));
    await askForLink(s.signIn, known);
    vi.setSystemTime(new Date('2026-11-11T09:10:01Z'));
    const late = await open(s.signIn, lastLink(s.queued));
    expect(late.headers.get('location')).toContain('error=INVALID_TOKEN');
    expect(sessionCookie(late)).toBeUndefined();
    expect(s.store['session']).toEqual([]);
  });

  it('refuses a made-up token', async () => {
    const response = await open(
      s.signIn,
      `${appUrl}/api/auth/magic-link/verify?token=${'A'.repeat(32)}&callbackURL=%2Fapp`,
    );
    expect(response.headers.get('location')).toContain('error=INVALID_TOKEN');
    expect(sessionCookie(response)).toBeUndefined();
  });

  // CI's `services` failures on 4a5ddd0: a person made outside Better Auth (the seeds, an invitation) starts with their
  // address unverified, and the link is what verifies it.
  it('signs in an account whose address is not verified yet, and marks it verified', async () => {
    const unverified = await setup({ emailVerified: false });
    await askForLink(unverified.signIn, known);
    const first = await open(unverified.signIn, lastLink(unverified.queued));
    expect(first.status).toBe(302);
    expect(sessionCookie(first)).toBeDefined();
    expect(unverified.store['user']?.[0]?.['emailVerified']).toBe(true);
  });

  it("doesn't sign up an address whose account was removed after it asked", async () => {
    await askForLink(s.signIn, known);
    const context = await s.signIn.auth.$context;
    await context.internalAdapter.deleteUser(s.userId);
    const response = await open(s.signIn, lastLink(s.queued));
    expect(sessionCookie(response)).toBeUndefined();
    expect(s.store['user']).toEqual([]);
  });
});

describe('sessions (§13, §15)', () => {
  async function signedIn(setupWith: Setup): Promise<string> {
    await askForLink(setupWith.signIn, known);
    const cookie = sessionCookie(await open(setupWith.signIn, lastLink(setupWith.queued)));
    if (cookie === undefined) throw new Error('not signed in');
    return cookie.split(';')[0] ?? '';
  }

  const sessionOf = (signIn: SignIn, cookie: string) => signIn.getSession(new Headers({ cookie }));

  it('last 30 days', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T09:00:00Z'));
    const cookie = await signedIn(s);
    const session = await sessionOf(s.signIn, cookie);
    expect(session?.session.expiresAt.toISOString()).toBe('2026-12-11T09:00:00.000Z');
    expect(SESSION_DAYS).toBe(30);
  });

  it('renew while in use', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T09:00:00Z'));
    const cookie = await signedIn(s);
    vi.setSystemTime(new Date('2026-12-01T09:00:00Z'));
    const used = await sessionOf(s.signIn, cookie);
    expect(used?.session.expiresAt.toISOString()).toBe('2026-12-31T09:00:00.000Z');
  });

  it('end after 30 days unused', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T09:00:00Z'));
    const cookie = await signedIn(s);
    vi.setSystemTime(new Date('2026-12-11T09:00:01Z'));
    expect(await sessionOf(s.signIn, cookie)).toBeNull();
  });

  it('live in the session store (Postgres in production), not in the cookie', async () => {
    const cookie = await signedIn(s);
    expect(s.store['session']).toHaveLength(1);
    expect(cookie).not.toContain(s.userId);
  });

  it('set an HttpOnly, Secure, SameSite=Lax cookie in production mode', async () => {
    const production = await setup({ secureCookies: true });
    await askForLink(production.signIn, known);
    const response = await open(production.signIn, lastLink(production.queued));
    const cookies = response.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/;\s*HttpOnly/i);
      expect(cookie).toMatch(/;\s*Secure/i);
      expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    }
    expect(sessionCookie(response)).toMatch(/^__Secure-/);
  });

  it('keep HttpOnly and SameSite=Lax over plain HTTP in development, where Secure would lose the cookie', async () => {
    await askForLink(s.signIn, known);
    const cookie = sessionCookie(await open(s.signIn, lastLink(s.queued))) ?? '';
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).not.toMatch(/;\s*Secure/i);
  });

  it('end on sign-out', async () => {
    const cookie = await signedIn(s);
    const out = await s.signIn.handler(
      new Request(`${appUrl}/api/auth/sign-out`, {
        method: 'POST',
        headers: { cookie, origin: appUrl },
      }),
    );
    expect(out.status).toBe(200);
    expect(await sessionOf(s.signIn, cookie)).toBeNull();
  });
});

describe('rate limits (§13, Q9: 5 per address and 20 per IP, per hour)', () => {
  it('sets the limits Q9 decided', () => {
    expect(SIGN_IN_LIMITS).toEqual({ perAddress: 5, perIp: 20, windowSeconds: 3600 });
  });

  it('counts every request by IP and by address, known or not, and never keeps a plain address', async () => {
    await askForLink(s.signIn, known, { 'x-forwarded-for': '203.0.113.7' });
    await askForLink(s.signIn, unknown, { 'x-forwarded-for': '203.0.113.7' });
    const buckets = s.limiter.calls.map((call) => call.bucket);
    expect(new Set(buckets).size).toBe(3); // one IP, two addresses
    expect(buckets.join(' ')).not.toMatch(/@|203\.0\.113\.7|nadia|stranger/);
    expect(s.limiter.calls.every((call) => call.windowSeconds === 3600)).toBe(true);
  });

  it('refuses a sixth email to one address within the hour, and queues nothing for it', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await askForLink(s.signIn, known)).status).toBe(200);
    }
    const sixth = await askForLink(s.signIn, known);
    expect(sixth.status).toBe(429);
    expect(s.queued).toHaveLength(5);
  });

  it('refuses an unknown address the same way at its sixth, so a refusal tells nothing either', async () => {
    for (let i = 0; i < 5; i += 1) await askForLink(s.signIn, unknown);
    expect((await askForLink(s.signIn, unknown)).status).toBe(429);
  });

  it('refuses a 21st request from one IP within the hour, whatever the address', async () => {
    const ip = { 'x-forwarded-for': '198.51.100.20' };
    for (let i = 0; i < 20; i += 1) {
      expect((await askForLink(s.signIn, `person-${String(i)}@example.com`, ip)).status).toBe(200);
    }
    expect((await askForLink(s.signIn, known, ip)).status).toBe(429);
    expect(s.queued).toEqual([]);
    // Another IP is its own bucket.
    const other = await askForLink(s.signIn, known, { 'x-forwarded-for': '198.51.100.21' });
    expect(other.status).toBe(200);
  });
});

describe('what the route handler serves', () => {
  const endpointPaths = () =>
    Object.values(s.signIn.auth.api as Record<string, { path?: string }>)
      .map((endpoint) => endpoint.path)
      .filter((path): path is string => typeof path === 'string');

  it('serves exactly the email-link endpoints, the session and sign-out', () => {
    expect(SERVED_ENDPOINTS).toEqual([
      'POST /sign-in/magic-link',
      'GET /magic-link/verify',
      'GET /get-session',
      'POST /sign-out',
    ]);
  });

  it('answers 404 to every other Better Auth endpoint: no password, Google or account-changing route', async () => {
    const served = SERVED_ENDPOINTS.map((entry) => entry.split(' ')[1]);
    const others = endpointPaths().filter((path) => !served.includes(path));
    expect(others).toEqual(
      expect.arrayContaining([
        '/sign-up/email',
        '/sign-in/email',
        '/sign-in/social',
        '/request-password-reset',
        '/update-user',
        '/delete-user',
      ]),
    );
    for (const path of others) {
      for (const method of ['GET', 'POST']) {
        const response = await s.signIn.handler(
          new Request(`${appUrl}/api/auth${path.replace(/:\w+/g, 'x')}`, {
            method,
            headers: { 'content-type': 'application/json', origin: appUrl },
            ...(method === 'POST' ? { body: '{}' } : {}),
          }),
        );
        expect(response.status, `${method} ${path}`).toBe(404);
      }
    }
  });

  it('answers 404 to a served path asked with another method, or outside /api/auth', async () => {
    for (const request of [
      new Request(`${appUrl}/api/auth/sign-in/magic-link`, { method: 'GET' }),
      new Request(`${appUrl}/api/auth/get-session/`, { method: 'GET' }),
      new Request(`${appUrl}/get-session`, { method: 'GET' }),
    ]) {
      expect((await s.signIn.handler(request)).status, request.url).toBe(404);
    }
  });

  it('has the email-link plugin only: no organization plugin, so no organization endpoint (decision 2)', () => {
    expect(s.signIn.auth.options.plugins.map((plugin) => plugin.id)).toEqual(['magic-link']);
    expect(endpointPaths().filter((path) => /organization|invitation|member/i.test(path))).toEqual(
      [],
    );
  });

  it('turns passwords and Google off', () => {
    expect(s.signIn.auth.options.emailAndPassword.enabled).toBe(false);
    expect(s.signIn.auth.options.socialProviders).toEqual({});
  });
});

describe('the logs (§13: no emails in logs)', () => {
  it('never show an address, whatever happens', async () => {
    const written: string[] = [];
    const capture = (...args: unknown[]) => {
      written.push(args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '));
    };
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation(capture);
    }
    for (const stream of [process.stdout, process.stderr]) {
      vi.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
        written.push(String(chunk));
        return true;
      });
    }

    const failing = createSignIn({
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      secret: authKey,
      appUrl,
      secureCookies: false,
      hitRateLimit: () => Promise.resolve(true),
      queueSignInEmail: ({ to }) => Promise.reject(new Error(`could not queue the email to ${to}`)),
    });
    const context = await failing.auth.$context;
    await context.internalAdapter.createUser(
      { email: known, name: 'Nadia', emailVerified: true },
      { method: 'magic-link' },
    );

    await askForLink(s.signIn, known);
    await askForLink(s.signIn, unknown);
    await open(s.signIn, lastLink(s.queued));
    await open(s.signIn, lastLink(s.queued));
    for (let i = 0; i < 6; i += 1) await askForLink(s.signIn, unknown);
    await askForLink(s.signIn, 'not an address');
    expect((await askForLink(failing, known)).status).toBe(500);

    expect(written.join('\n')).not.toMatch(/nadia|stranger|golpo|@[\w-]+\.example/i);
  });
});

describe('ids', () => {
  // On Postgres the database makes them, with `uuidv7()` (server.int.test.ts checks a session's); the memory adapter
  // has no such default, so Better Auth makes them here.
  it('are UUIDs, as #71’s uuid columns take', async () => {
    await askForLink(s.signIn, known);
    await open(s.signIn, lastLink(s.queued));
    const ids = [s.userId, ...(s.store['session'] ?? []).map((row) => String(row['id']))];
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id).toMatch(UUID);
  });
});

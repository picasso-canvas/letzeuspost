// Email-link sign-in (#77, §13 Sign-in and sessions, A5, Q9, §15), through the route handler the web app mounts, on
// Better Auth's memory adapter: the same Better Auth, plugin and hooks as production, without Postgres.
// server.int.test.ts runs the flow again on Postgres, through the auth handle.
import { signInLimits } from '@lzp/config';
import type { DBAdapterInstance } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSignIn,
  kindOf,
  SERVED_ENDPOINTS,
  SESSION_DAYS,
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

/** The adapter, recording the name of every operation Better Auth asks of it, in order. */
function recording(inner: DBAdapterInstance, operations: string[]): DBAdapterInstance {
  return (options) =>
    new Proxy(inner(options), {
      get(target, key, receiver) {
        const value: unknown = Reflect.get(target, key, receiver);
        if (typeof value !== 'function' || typeof key !== 'string') return value;
        return (...args: unknown[]): unknown => {
          operations.push(key);
          return Reflect.apply(value as (...given: unknown[]) => unknown, target, args);
        };
      },
    });
}

interface Setup {
  signIn: SignIn;
  store: Record<string, Record<string, unknown>[]>;
  queued: SignInEmail[];
  limiter: ReturnType<typeof countingLimiter>;
  /** The database operations since the account was made. */
  operations: string[];
  userId: string;
}

async function setup(
  options: { environment?: string; emailVerified?: boolean } = {},
): Promise<Setup> {
  const store: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const queued: SignInEmail[] = [];
  const limiter = countingLimiter();
  const operations: string[] = [];
  const signIn = createSignIn({
    database: likePostgresIds(recording(memoryAdapter(store), operations)),
    secret: authKey,
    appUrl,
    environment: options.environment ?? 'development',
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
  operations.length = 0;
  return { signIn, store, queued, limiter, operations, userId: user.id };
}

/** The work handed to run after the answer, as Next's `after()` would be (decision 5), until it is run. */
const pending: (() => Promise<void>)[] = [];
const afterAnswer = (task: () => Promise<void>) => {
  pending.push(task);
};

/** Runs the work handed over so far, as Next does once the answer is sent. */
async function runAfterAnswer(): Promise<void> {
  for (let task = pending.shift(); task !== undefined; task = pending.shift()) await task();
}

/**
 * The connecting address, as Next's server gives a route handler it in development and CI: in `x-forwarded-for`, when
 * the request brought none of its own (decision 4).
 */
const connecting = { 'x-forwarded-for': '192.0.2.1' };

/** Asks for a link and gets the answer; what runs after it is left pending. A header given as '' is left out. */
function ask(
  signIn: SignIn,
  email: string,
  headers: Record<string, string> = connecting,
  callbackURL = '/app',
) {
  const sent = { 'content-type': 'application/json', origin: appUrl, ...headers };
  return signIn.handler(
    new Request(`${appUrl}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: Object.entries(sent).filter(([, value]) => value !== ''),
      body: JSON.stringify({ email, callbackURL }),
    }),
    afterAnswer,
  );
}

/** Asks for a link, then lets what runs after the answer run. */
async function askForLink(signIn: SignIn, email: string, headers?: Record<string, string>) {
  const response = await ask(signIn, email, headers);
  await runAfterAnswer();
  return response;
}

/** The bucket of the IP each request counted in: the first of its two buckets. */
const ipBuckets = (limiter: Setup['limiter']) =>
  limiter.calls.filter((_, i) => i % 2 === 0).map((call) => call.bucket);

function open(signIn: SignIn, url: string) {
  return signIn.handler(new Request(url, { headers: { origin: appUrl } }), afterAnswer);
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
  pending.length = 0;
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
    const production = await setup({ environment: 'production' });
    await askForLink(production.signIn, known, { 'cf-connecting-ip': '198.51.100.7' });
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
      afterAnswer,
    );
    expect(out.status).toBe(200);
    expect(await sessionOf(s.signIn, cookie)).toBeNull();
  });
});

describe('rate limits (§13, Q9: 5 per address and 20 per IP, per hour)', () => {
  it('counts at the limits config/sign-in.ts sets (Q9: config values)', async () => {
    await askForLink(s.signIn, known);
    expect(s.limiter.calls.map(({ limit, windowSeconds }) => ({ limit, windowSeconds }))).toEqual([
      { limit: signInLimits.perIp, windowSeconds: signInLimits.windowSeconds },
      { limit: signInLimits.perAddress, windowSeconds: signInLimits.windowSeconds },
    ]);
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

describe('the client IP (decision 4: Cloudflare is in front in staging and production)', () => {
  it.each(['production', 'staging'])(
    'in %s, is cf-connecting-ip alone: a forged x-forwarded-for doesn’t change the bucket',
    async (environment) => {
      const deployed = await setup({ environment });
      const from = (forwarded: string) => ({
        'cf-connecting-ip': '198.51.100.7',
        'x-forwarded-for': forwarded,
      });
      await askForLink(deployed.signIn, known, from('203.0.113.1'));
      await askForLink(deployed.signIn, known, from('203.0.113.2'));
      await askForLink(deployed.signIn, known, { 'cf-connecting-ip': '198.51.100.8' });
      const [first, second, third] = ipBuckets(deployed.limiter);
      expect(first).toBe(second);
      expect(third).not.toBe(first);
      expect(deployed.signIn.auth.options.advanced.ipAddress).toEqual({
        ipAddressHeaders: ['cf-connecting-ip'],
      });
    },
  );

  it.each([
    ['no cf-connecting-ip', connecting],
    ['a cf-connecting-ip that is no address', { 'cf-connecting-ip': 'unknown' }],
    ['a cf-connecting-ip with two addresses', { 'cf-connecting-ip': '198.51.100.7, 10.0.0.1' }],
  ])(
    'in production, refuses a request with %s before counting it or writing anything',
    async (_, headers) => {
      const production = await setup({ environment: 'production' });
      const response = await askForLink(production.signIn, known, headers);
      expect(response.status).toBe(400);
      expect(production.limiter.calls).toEqual([]);
      expect(production.queued).toEqual([]);
      expect(production.store['verification']).toEqual([]);
    },
  );

  it.each(['development', 'ci'])(
    'in %s, is the connecting address, and a cf-connecting-ip counts for nothing',
    async (environment) => {
      const local = await setup({ environment });
      await askForLink(local.signIn, known, { 'x-forwarded-for': '192.0.2.1' });
      await askForLink(local.signIn, known, {
        'x-forwarded-for': '192.0.2.1',
        'cf-connecting-ip': '198.51.100.7',
      });
      await askForLink(local.signIn, known, { 'x-forwarded-for': '192.0.2.2' });
      const [first, second, third] = ipBuckets(local.limiter);
      expect(second).toBe(first);
      expect(third).not.toBe(first);
    },
  );

  it('refuses a request whose address it can’t tell, in development too: no shared bucket', async () => {
    const unclear: Record<string, string>[] = [{}, { 'x-forwarded-for': '192.0.2.1, 192.0.2.2' }];
    for (const headers of unclear) {
      const local = await setup({ environment: 'development' });
      expect((await askForLink(local.signIn, known, headers)).status).toBe(400);
      expect(local.limiter.calls).toEqual([]);
    }
  });
});

describe('a request from another site (Better Auth’s form-CSRF check, before any limit is counted)', () => {
  const foreign = 'https://evil.example';

  it.each([
    [
      'a cross-site form post (a navigation)',
      {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        origin: foreign,
      },
    ],
    [
      'a cross-site fetch',
      { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', origin: foreign },
    ],
    ['a foreign Origin, with no Fetch Metadata', { origin: foreign }],
    ['a foreign Referer, with no Origin', { origin: '', referer: `${foreign}/page` }],
    ['a foreign Origin with a cookie', { origin: foreign, cookie: 'theme=dark' }],
  ])('refuses %s with 403, counts nothing and hands nothing over', async (_, headers) => {
    const response = await askForLink(s.signIn, known, { ...connecting, ...headers });
    expect(response.status).toBe(403);
    expect(s.limiter.calls).toEqual([]);
    expect(s.queued).toEqual([]);
    expect(s.store['verification']).toEqual([]);
  });

  it('refuses it in production too, behind Cloudflare', async () => {
    const production = await setup({ environment: 'production' });
    const response = await askForLink(production.signIn, known, {
      'cf-connecting-ip': '198.51.100.7',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
      origin: foreign,
    });
    expect(response.status).toBe(403);
    expect(production.limiter.calls).toEqual([]);
  });

  it.each([
    [
      'a same-origin fetch',
      { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', origin: appUrl },
    ],
    ['a request with no browser headers (the app’s own code)', { origin: '' }],
  ])('lets %s through both limits as before', async (_, headers) => {
    const response = await askForLink(s.signIn, known, { ...connecting, ...headers });
    expect(response.status).toBe(200);
    expect(s.limiter.calls).toHaveLength(2);
    expect(s.queued.map((email) => email.to)).toEqual([known]);
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
          afterAnswer,
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
      expect((await s.signIn.handler(request, afterAnswer)).status, request.url).toBe(404);
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
  /** Everything written to the console or the process's streams from now on, until the mocks are restored. */
  function captureLogs(): string[] {
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
    return written;
  }

  it('never show an address, whatever happens', async () => {
    const written = captureLogs();

    const failing = createSignIn({
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      secret: authKey,
      appUrl,
      environment: 'development',
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
    // Refused as cross-site; Better Auth logs the Referer it refused, here with an address in it, URL-encoded.
    await askForLink(s.signIn, known, {
      ...connecting,
      origin: '',
      referer: 'https://evil.example/?to=nadia%40golpo-cafe.example',
    });
    // Its email couldn't be queued: after the answer, so the answer is the usual one, and the failure is logged.
    expect((await askForLink(failing, known)).status).toBe(200);

    expect(written.join('\n')).toMatch(
      /auth\.error: a sign-in link failed after the answer: Error/,
    );
    expect(written.join('\n')).not.toMatch(/nadia|stranger|golpo|@[\w-]+\.example/i);
  });

  // Cerberus round 3, F1: Better Auth logs a refused Origin, Referer or callbackURL whole, before any limit counts the
  // request. A long run with no address in it must not make masking it block the process.
  const long = (size: number) => `nadia%40golpo-cafe.example;${'a'.repeat(size)}`;

  it.each([
    [
      'a 16 KB Referer from another site',
      { origin: '', referer: `https://evil.example/?to=${long(16 * 1024)}` },
      '/app',
    ],
    [
      'a 1 MB callbackURL to another site',
      {},
      `https://evil.example/?to=${long(1024 * 1024)}`.replace('%40', '@'),
    ],
  ])('mask %s at once, and keep its line short', async (_, headers, callbackURL) => {
    const written = captureLogs();
    const started = performance.now();
    const response = await ask(s.signIn, known, { ...connecting, ...headers }, callbackURL);
    const took = performance.now() - started;

    expect(response.status).toBe(403);
    expect(took).toBeLessThan(200);
    expect(written.join('\n')).toMatch(/auth\.error: Invalid (origin|callbackURL): /);
    expect(written.join('\n')).not.toMatch(/nadia|golpo/i);
    for (const line of written) expect(line.length).toBeLessThanOrEqual(600);
    expect(s.limiter.calls).toEqual([]);
  });
});

describe('kindOf: an error as packages/auth logs it', () => {
  it('is its name and a driver’s code, never its message', () => {
    const failed = Object.assign(new Error(`could not reach ${known}`), { code: 'ECONNREFUSED' });
    expect(kindOf(failed)).toBe('Error ECONNREFUSED');
    expect(kindOf(new TypeError(`bad ${known}`))).toBe('TypeError');
  });

  it('leaves out a name or code that could carry text, and says "unknown" when nothing is left', () => {
    expect(kindOf({ name: `to ${known}`, code: 42 })).toBe('unknown');
    expect(kindOf({ name: 'Error', code: 'x'.repeat(41) })).toBe('Error');
    expect(kindOf({})).toBe('unknown');
    expect(kindOf(`failed for ${known}`)).toBe('unknown');
    expect(kindOf(null)).toBe('unknown');
  });
});

describe('the answer (decision 5: nothing tells a known address by its timing)', () => {
  it('comes before the known address’s link and email, which are made after it', async () => {
    const response = await ask(s.signIn, known);
    expect(await response.json()).toEqual({ status: true });
    expect(s.store['verification']).toEqual([]);
    expect(s.queued).toEqual([]);
    expect(pending).toHaveLength(1);

    await runAfterAnswer();
    expect(s.store['verification']).toHaveLength(1);
    expect(s.queued.map((email) => email.to)).toEqual([known]);
  });

  it('comes after the same work for a known and an unknown address: their limits, and no read of accounts', async () => {
    const before = async (email: string) => {
      const fresh = await setup();
      const response = await ask(fresh.signIn, email);
      const seen = {
        status: response.status,
        body: await response.text(),
        database: [...fresh.operations],
        limits: fresh.limiter.calls.length,
        later: pending.length,
      };
      await runAfterAnswer();
      return { seen, links: fresh.store['verification']?.length, emails: fresh.queued.length };
    };
    const forKnown = await before(known);
    const forUnknown = await before(unknown);
    expect(forUnknown.seen).toEqual(forKnown.seen);
    expect(forKnown.seen).toMatchObject({ status: 200, database: [], limits: 2, later: 1 });
    // After the answer, only the known address gets a link and an email.
    expect([forKnown.links, forKnown.emails]).toEqual([1, 1]);
    expect([forUnknown.links, forUnknown.emails]).toEqual([0, 0]);
  });

  it('refuses a body that is no address with the endpoint’s own error, and hands nothing over', async () => {
    const response = await ask(s.signIn, 'not an address');
    expect(response.status).toBe(400);
    expect(pending).toEqual([]);
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

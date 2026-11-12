// Email-link sign-in and sessions (#77, §13 Sign-in and sessions): Better Auth 1.7 with its magic-link plugin and
// nothing else. No passwords and no Google (Google comes before the first partner, §18); no organization plugin, so no
// organization endpoint (Athena's decision 2, 2026-11-11): workspaces are packages/auth's own (./workspaces.ts).
//
// - A link works once and for 10 minutes (A5); its token is stored hashed, and an unknown address never gets an
//   account (sign-up is off).
// - Only existing accounts get an email. An unknown address gets the same answer as a known one, and nothing is
//   written for it: no link, no email (Q9). The answer comes first, after the same work for both (their limits): the
//   known address's link, its outbox row and job are made once it is sent, in the work the handler hands to
//   `afterAnswer`, Next's `after()` (decision 5).
// - The request writes no email itself: `queueSignInEmail` puts a row in the account emails' outbox and queues the
//   `account-email` job (./server.ts), which the worker sends.
// - Requests are limited per address and per IP, known addresses or not, at config/sign-in.ts's limits (Q9), in
//   Postgres (`hitRateLimit`). The IP is cf-connecting-ip in staging and production, the connecting address in
//   development and CI; a request without one is refused (decision 4).
// - Sessions last 30 days and renew while in use (§15): Better Auth extends a session a day or more old by 30 days
//   from its use. They live in the session table, and the cookie holds only the session's token: HttpOnly,
//   SameSite=Lax, and Secure wherever the app is HTTPS (staging and production: config/env.ts's `servedOverHttps`).
// - The handler serves only SERVED_ENDPOINTS; every other Better Auth route answers 404.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { servedOverHttps, signInLimits } from '@lzp/config';
import { betterAuth, type BetterAuthOptions, type DBAdapterInstance } from 'better-auth';
import { APIError, createAuthMiddleware, formCsrfMiddleware, getIP } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins/magic-link';

/** A5: sign-in links last 10 minutes. */
export const SIGN_IN_LINK_MINUTES = 10;
/** §15: sessions last 30 days and renew while in use. */
export const SESSION_DAYS = 30;
/** The @lzp/email template of the sign-in email. */
export const SIGN_IN_TEMPLATE = 'sign-in-link';

/** Where the web app mounts the handler (apps/web/src/app/api/auth/[...all]/route.ts). */
export const AUTH_BASE_PATH = '/api/auth';

/**
 * Every Better Auth endpoint the route handler serves, below AUTH_BASE_PATH: asking for a link, opening it, reading
 * the session and signing out. Anything else answers 404.
 */
export const SERVED_ENDPOINTS = [
  'POST /sign-in/magic-link',
  'GET /magic-link/verify',
  'GET /get-session',
  'POST /sign-out',
] as const;

const DAY_SECONDS = 24 * 60 * 60;

/** The sign-in email to queue: for an existing account only. */
export interface SignInEmail {
  readonly userId: string;
  readonly to: string;
  /** The link: it signs `to` in, once, within 10 minutes. */
  readonly url: string;
}

export interface SignInDeps {
  /** Better Auth's database: the drizzle adapter on the auth handle's tables (./server.ts), or a test's. */
  readonly database: DBAdapterInstance;
  /** AUTH_SECRET. */
  readonly secret: string;
  /** APP_URL. */
  readonly appUrl: string;
  /** LZP_ENV: where the app runs. Its cookies are Secure wherever it is HTTPS only (config/env.ts). */
  readonly environment: string;
  /** @lzp/db/auth's hitRateLimit: counts the request in the bucket, or says false when the bucket is full. */
  readonly hitRateLimit: (bucket: string, limit: number, windowSeconds: number) => Promise<boolean>;
  /** Writes the outbox row and queues its job. */
  readonly queueSignInEmail: (email: SignInEmail) => Promise<void>;
}

/**
 * Each run of characters an address could be part of, in whatever Better Auth logs. A run with `@` in it, or `%40` as in
 * a refused Referer or callbackURL it logs whole, is masked whole (§13: no emails in logs). Each run is read once, so
 * masking takes time in line with the message's length: a pattern that looked for the `@` inside the run would take
 * the square of it, and block the process on a long header (Cerberus round 3, F1).
 */
const RUN = /[^\s<>"'(),;:]+/g;
const AT = /@|%40/i;
/** The most of a message a log line keeps, once masked: a refused header or callbackURL may be a megabyte long. */
const LOG_MESSAGE_MAX = 512;

/** Better Auth's log lines, masked, and without their extra arguments: those may be records with an address in them. */
function log(level: string, message: string): void {
  const masked = message.replace(RUN, (run) => (AT.test(run) ? '[address]' : run));
  const kept = masked.length > LOG_MESSAGE_MAX ? `${masked.slice(0, LOG_MESSAGE_MAX)}…` : masked;
  console.error(`auth.${level}: ${kept}`);
}

const tooMany = () =>
  new APIError('TOO_MANY_REQUESTS', {
    code: 'TOO_MANY_REQUESTS',
    message: 'Too many sign-in links were asked for. Try again in an hour.',
  });

const noClientIp = () =>
  new APIError('BAD_REQUEST', {
    code: 'CLIENT_IP_UNKNOWN',
    message: 'This request could not be checked. Try again.',
  });

/** What a request for a link asks for, once the endpoint's own schema has checked it. */
interface LinkRequest {
  readonly email: string;
  readonly callbackURL?: string | undefined;
  readonly newUserCallbackURL?: string | undefined;
  readonly errorCallbackURL?: string | undefined;
}

/** The link endpoint, as the hook uses it: Better Auth's own, once it exists (`createSignIn`). */
interface Links {
  /** The request, if the endpoint's schema takes it; null if the endpoint would refuse it. */
  check: (body: unknown) => Promise<LinkRequest | null>;
  /** Makes the link and queues its email if `request.email` has an account; for anyone else, nothing. */
  make: (request: LinkRequest) => Promise<void>;
}

/** Hands work over to run once the answer is sent: Next's `after()`, which the route passes (decision 5). */
export type AfterAnswer = (task: () => Promise<void>) => void;

/** The `afterAnswer` of the request being handled, for the hook. */
const answering = new AsyncLocalStorage<AfterAnswer>();

/**
 * The rate-limit bucket a sign-in request counts in, for an address (trimmed, lowercase) or an IP: its kind and a hash
 * of its value keyed with AUTH_SECRET, so the table never holds an address or an IP.
 */
export function signInBucket(secret: string, kind: 'address' | 'ip', value: string): string {
  return `sign-in:${kind}:${createHmac('sha256', secret).update(value).digest('hex')}`;
}

function options(deps: SignInDeps, links: Links) {
  const bucket = (kind: 'address' | 'ip', value: string) => signInBucket(deps.secret, kind, value);
  const { perAddress, perIp, windowSeconds } = signInLimits;
  // Decision 4 (Athena, 2026-11-11): Cloudflare is in front exactly where the app is HTTPS only, staging and
  // production (§14), and it alone sets cf-connecting-ip there. In development and CI, Next's server puts the
  // connecting address in x-forwarded-for, when the request brought none of its own.
  const ipHeader = servedOverHttps(deps.environment) ? 'cf-connecting-ip' : 'x-forwarded-for';
  /**
   * The client's address, if `ipHeader` holds exactly one; otherwise null, never a stand-in: Better Auth's own
   * fallback (127.0.0.1 in development and tests) would put every such request in one bucket. Better Auth gives it in
   * its normal form, an IPv6 address cut to its /64, so one network can't change its bucket by changing its address.
   */
  const clientIp = (headers: Headers, authOptions: BetterAuthOptions): string | null =>
    isIP(headers.get(ipHeader)?.trim() ?? '') === 0 ? null : getIP(headers, authOptions);

  return {
    appName: 'LetZeusPost',
    baseURL: deps.appUrl,
    basePath: AUTH_BASE_PATH,
    secret: deps.secret,
    trustedOrigins: [deps.appUrl],
    database: deps.database,
    emailAndPassword: { enabled: false },
    socialProviders: {},
    session: {
      expiresIn: SESSION_DAYS * DAY_SECONDS,
      updateAge: DAY_SECONDS,
      // Set by packages/auth itself, after a membership check (./workspaces.ts); never from a request.
      additionalFields: { activeWorkspaceId: { type: 'string', required: false, input: false } },
    },
    // §13's limits live in Postgres (the hook below); Better Auth's own limiter would keep them in memory.
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    logger: { level: 'warn', log },
    // An unexpected error goes on to `handler`, which logs its kind alone: left to Better Auth's router, its message
    // (a driver's, say, quoting an address) would be printed whole.
    onAPIError: { throw: true },
    advanced: {
      // Better Auth turns its Origin and cross-site checks off when NODE_ENV is `test`: they are on everywhere here.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ipAddress: { ipAddressHeaders: [ipHeader] },
      useSecureCookies: servedOverHttps(deps.environment),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      // #71's ids are `uuid` columns that Postgres fills with `uuidv7()`. 'uuid' leaves them to it, and makes the ids
      // Better Auth sets itself UUIDs too: with any other choice, the lock row it writes while verifying an address is
      // given a base64url id, which Postgres refuses (CI's `services` failures on 4a5ddd0).
      database: { generateId: 'uuid' },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/magic-link') return undefined;
        // packages/auth's own call after the answer (`links.make`), the only one with no request: its request was
        // checked and counted here already.
        if (ctx.request === undefined) return undefined;
        // The endpoint's own cross-site check (its `use: [formCsrfMiddleware]`), which the answer below would skip, and
        // before any limit: another site's page can't spend an address's limit from its visitors' browsers.
        await formCsrfMiddleware(ctx);
        const body: unknown = ctx.body;
        const given =
          typeof body === 'object' && body !== null
            ? (body as { email?: unknown }).email
            : undefined;
        // Not text: the endpoint refuses it, before any link is made.
        if (typeof given !== 'string') return undefined;
        const address = given.trim().toLowerCase();
        const ip = clientIp(ctx.request.headers, ctx.context.options);
        // Without an address there is no bucket to count it in, and sharing one would let anyone fill it for all.
        if (ip === null) throw noClientIp();
        // Every request counts, known address or not, so a refusal says nothing about who has an account.
        if (!(await deps.hitRateLimit(bucket('ip', ip), perIp, windowSeconds))) throw tooMany();
        if (!(await deps.hitRateLimit(bucket('address', address), perAddress, windowSeconds))) {
          throw tooMany();
        }
        // A body the endpoint refuses goes on to it, which answers with its own error before any link is made.
        const asked = await links.check(body);
        if (asked === null) return undefined;
        // Q9 and decision 5: every address gets the endpoint's answer now, before anything is read of accounts. Who
        // has one, their link and its email are found and made after it (`links.make`).
        const afterAnswer = answering.getStore();
        if (afterAnswer === undefined) throw new Error('sign-in: no way to work after the answer');
        afterAnswer(() =>
          links.make({ ...asked, email: address }).catch((error: unknown) => {
            log('error', `a sign-in link failed after the answer: ${kindOf(error)}`);
          }),
        );
        return ctx.json({ status: true });
      }),
    },
    plugins: [
      magicLink({
        expiresIn: SIGN_IN_LINK_MINUTES * 60,
        disableSignUp: true,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }, ctx) => {
          const found = await ctx?.context.internalAdapter.findUserByEmail(email);
          // Removed since `links.make` found them: no email.
          if (found === null || found === undefined) return;
          await deps.queueSignInEmail({ userId: found.user.id, to: found.user.email, url });
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}

const notFound = () => new Response(null, { status: 404 });

/**
 * An error's kind, for packages/auth's log lines: its name and a driver's code, never its message (it may quote an
 * address or a statement); a part that isn't a short word is left out, and "unknown" stands for nothing left.
 */
export function kindOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const { name, code } = error as { name?: unknown; code?: unknown };
  const parts = [name, code].filter(
    (part) => typeof part === 'string' && /^[\w.-]{1,40}$/.test(part),
  );
  return parts.length === 0 ? 'unknown' : parts.join(' ');
}

export function createSignIn(deps: SignInDeps) {
  const links: Links = {
    check: () => Promise.reject(new Error('sign-in: not ready')),
    make: () => Promise.reject(new Error('sign-in: not ready')),
  };
  const auth = betterAuth(options(deps, links));
  const schema = auth.api.signInMagicLink.options.body['~standard'];
  links.check = async (body) => {
    const result = await schema.validate(body);
    return result.issues === undefined ? result.value : null;
  };
  links.make = async (request) => {
    const context = await auth.$context;
    if ((await context.internalAdapter.findUserByEmail(request.email)) === null) return;
    await auth.api.signInMagicLink({ body: request, headers: new Headers() });
  };
  const served = new Set<string>(SERVED_ENDPOINTS);
  return {
    /** The Better Auth instance, for packages/auth alone: the web app gets `handler`. */
    auth,
    /**
     * The route handler: SERVED_ENDPOINTS only. `afterAnswer` runs what must wait for the answer: the route passes
     * Next's `after()`.
     */
    handler: async (request: Request, afterAnswer: AfterAnswer): Promise<Response> => {
      const { pathname } = new URL(request.url);
      const path = pathname.startsWith(`${AUTH_BASE_PATH}/`)
        ? pathname.slice(AUTH_BASE_PATH.length)
        : null;
      if (path === null || !served.has(`${request.method} ${path}`)) return notFound();
      try {
        return await answering.run(afterAnswer, () => auth.handler(request));
      } catch (error) {
        log('error', `${request.method} ${path} failed: ${kindOf(error)}`);
        return new Response(null, { status: 500 });
      }
    },
    /** The signed-in person and their session, from a request's cookie; null when signed out or expired. */
    getSession: (headers: Headers) => auth.api.getSession({ headers }),
  };
}

export type SignIn = ReturnType<typeof createSignIn>;

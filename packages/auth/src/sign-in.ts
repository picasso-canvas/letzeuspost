// Email-link sign-in and sessions (#77, §13 Sign-in and sessions): Better Auth 1.7 with its magic-link plugin and
// nothing else. No passwords and no Google (Google comes before the first partner, §18); no organization plugin, so no
// organization endpoint (Athena's decision 2, 2026-11-11): workspaces are packages/auth's own (./workspaces.ts).
//
// - A link works once and for 10 minutes (A5); its token is stored hashed, and an unknown address never gets an
//   account (sign-up is off).
// - Only existing accounts get an email. An unknown address gets the same answer as a known one, and nothing is
//   written for it: no link, no email (Q9).
// - The request writes no email itself: `queueSignInEmail` puts a row in the account emails' outbox and queues the
//   `account-email` job (./server.ts), which the worker sends.
// - Requests are limited per address and per IP, known addresses or not, at config/sign-in.ts's limits (Q9), in
//   Postgres (`hitRateLimit`).
// - Sessions last 30 days and renew while in use (§15): Better Auth extends a session a day or more old by 30 days
//   from its use. They live in the session table, and the cookie holds only the session's token: HttpOnly,
//   SameSite=Lax, and Secure wherever the app is HTTPS (staging and production: config/env.ts's `servedOverHttps`).
// - The handler serves only SERVED_ENDPOINTS; every other Better Auth route answers 404.
import { createHmac } from 'node:crypto';
import { servedOverHttps, signInLimits } from '@lzp/config';
import { betterAuth, type BetterAuthOptions, type DBAdapterInstance } from 'better-auth';
import { APIError, createAuthMiddleware, getIP } from 'better-auth/api';
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

/** Anything shaped like an address, masked in whatever Better Auth logs (§13: no emails in logs). */
const ADDRESS = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g;

/** Better Auth's log lines, masked, and without their extra arguments: those may be records with an address in them. */
function log(level: string, message: string): void {
  console.error(`auth.${level}: ${message.replace(ADDRESS, '[address]')}`);
}

const tooMany = () =>
  new APIError('TOO_MANY_REQUESTS', {
    code: 'TOO_MANY_REQUESTS',
    message: 'Too many sign-in links were asked for. Try again in an hour.',
  });

function options(deps: SignInDeps) {
  /** A bucket's name: its kind and a keyed hash of its value, so the table never holds an address or an IP. */
  const bucket = (kind: 'address' | 'ip', value: string) =>
    `sign-in:${kind}:${createHmac('sha256', deps.secret).update(value).digest('hex')}`;
  const { perAddress, perIp, windowSeconds } = signInLimits;

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
        const body: unknown = ctx.body;
        const given =
          typeof body === 'object' && body !== null
            ? (body as { email?: unknown }).email
            : undefined;
        // Not text: the endpoint refuses it, before any link is made.
        if (typeof given !== 'string') return undefined;
        const address = given.trim().toLowerCase();
        const ip = getIP(ctx.request ?? ctx.headers ?? new Headers(), ctx.context.options);
        // Every request counts, known address or not, so a refusal says nothing about who has an account. One IP
        // that can't be told (no trustworthy header) shares the `unknown` bucket.
        if (!(await deps.hitRateLimit(bucket('ip', ip ?? 'unknown'), perIp, windowSeconds))) {
          throw tooMany();
        }
        if (!(await deps.hitRateLimit(bucket('address', address), perAddress, windowSeconds))) {
          throw tooMany();
        }
        // Q9: an address with no account gets the endpoint's own answer, and no link is made for it. Only an
        // address that matches an account (so a valid one) goes on to the endpoint.
        const found = await ctx.context.internalAdapter.findUserByEmail(address);
        if (found === null) return ctx.json({ status: true });
        return undefined;
      }),
    },
    plugins: [
      magicLink({
        expiresIn: SIGN_IN_LINK_MINUTES * 60,
        disableSignUp: true,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }, ctx) => {
          const found = await ctx?.context.internalAdapter.findUserByEmail(email);
          // Removed since the hook found them: no email.
          if (found === null || found === undefined) return;
          await deps.queueSignInEmail({ userId: found.user.id, to: found.user.email, url });
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}

const notFound = () => new Response(null, { status: 404 });

/** An error's kind, for the log: its name and a driver's code, never its message. */
function kindOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const { name, code } = error as { name?: unknown; code?: unknown };
  return [name, code]
    .filter((part) => typeof part === 'string' && /^[\w.-]{1,40}$/.test(part))
    .join(' ');
}

export function createSignIn(deps: SignInDeps) {
  const auth = betterAuth(options(deps));
  const served = new Set<string>(SERVED_ENDPOINTS);
  return {
    /** The Better Auth instance, for packages/auth alone: the web app gets `handler`. */
    auth,
    /** The route handler: SERVED_ENDPOINTS only. */
    handler: async (request: Request): Promise<Response> => {
      const { pathname } = new URL(request.url);
      const path = pathname.startsWith(`${AUTH_BASE_PATH}/`)
        ? pathname.slice(AUTH_BASE_PATH.length)
        : null;
      if (path === null || !served.has(`${request.method} ${path}`)) return notFound();
      try {
        return await auth.handler(request);
      } catch (error) {
        log('error', `${request.method} ${path} failed: ${kindOf(error) || 'unknown'}`);
        return new Response(null, { status: 500 });
      }
    },
    /** The signed-in person and their session, from a request's cookie; null when signed out or expired. */
    getSession: (headers: Headers) => auth.api.getSession({ headers }),
  };
}

export type SignIn = ReturnType<typeof createSignIn>;

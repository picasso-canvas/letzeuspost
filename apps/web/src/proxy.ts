// Next.js's proxy (what middleware used to be). It does two jobs and nothing else:
//
// 1. A content security policy with a fresh nonce on every response (#76).
// 2. One optimistic redirect (#78): a visitor with no session cookie who opens an app page goes to /sign-in, and one
//    with a session cookie who opens /sign-in goes to the Inbox.
//
// It only looks for the cookie; it never asks whether the session is real, and it never holds the only check on
// anything: every page, action and route checks the session itself (§13). A forged cookie gets a visitor past this
// redirect and no further.
import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce } from './security/csp.ts';

const POLICY = 'content-security-policy';

// Staging and production are HTTPS only (§14). Decided from LZP_ENV, which the app checked at startup
// (instrumentation.ts), not from the request: behind Caddy the app sees plain http.
const HTTPS_ENVIRONMENTS: readonly string[] = ['staging', 'production'];

/** Where a signed-out visitor goes, and where a signed-in one goes from there: fixed, never taken from the request. */
const SIGN_IN = '/sign-in';
const INBOX = '/';

// Better Auth's session cookie (packages/auth, #77): `better-auth.session_token`, with `__Secure-` in front where the
// app is HTTPS. The session cache cookie (`session_data`) is not a session and isn't read.
const SESSION_COOKIES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

// Pages and routes that are for people without a session (§04 Public: /sign-in, /invite/[token], /r/[token]), routes
// that check for themselves (the API), and what the browser fetches for any page. Everything else is an app page.
const PUBLIC_PREFIXES = ['/invite/', '/r/', '/api/', '/_next/'];
const PUBLIC_FILES = ['/favicon.ico'];

const isSignInPage = (path: string) => path === SIGN_IN || path === `${SIGN_IN}/`;

const isPublic = (path: string) =>
  isSignInPage(path) ||
  PUBLIC_FILES.includes(path) ||
  PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));

const hasSessionCookie = (request: NextRequest) =>
  SESSION_COOKIES.some((name) => (request.cookies.get(name)?.value ?? '') !== '');

/** Where the request should go instead, or null to let it through. */
function redirectFor(request: NextRequest): string | null {
  const { pathname } = request.nextUrl;
  if (hasSessionCookie(request)) return isSignInPage(pathname) ? INBOX : null;
  return isPublic(pathname) ? null : SIGN_IN;
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce, {
    development: process.env.NODE_ENV === 'development',
    https: HTTPS_ENVIRONMENTS.includes(process.env.LZP_ENV ?? ''),
  });

  const to = redirectFor(request);
  if (to !== null) {
    // A relative address: behind Caddy the app can't know its public host, and never builds one from the request's.
    const redirect = new NextResponse(null, { status: 307, headers: { location: to } });
    redirect.headers.set(POLICY, policy);
    return redirect;
  }

  // Next.js reads the nonce from the policy on the request and stamps its own scripts with it. `x-nonce` is for our
  // own layout. Both are set here, so a value sent by the caller never reaches the page.
  const forwarded = new Headers(request.headers);
  forwarded.set(POLICY, policy);
  forwarded.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set(POLICY, policy);
  return response;
}

// Every path, so every response carries the policy (static files and the API included).
export const config = { matcher: '/:path*' };

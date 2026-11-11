// Next.js's proxy (what middleware used to be). Today it does one job: put a content security policy with a fresh nonce
// on every response. Sign-in and session checks join it in #77 and #78; it never holds the only check on anything
// (§13: every action and route checks the session itself).
import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce } from './security/csp.ts';

const POLICY = 'content-security-policy';

export function proxy(request: NextRequest): NextResponse {
  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce, {
    development: process.env.NODE_ENV === 'development',
    https: request.nextUrl.protocol === 'https:',
  });

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

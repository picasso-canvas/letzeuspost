import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxy } from './proxy.ts';

const CSP = 'content-security-policy';
/** Next.js hands a proxy's request-header changes to the page through these response headers. */
const forwarded = (name: string) => `x-middleware-request-${name}`;

function nonceOf(policy: string | null): string {
  const match = /'nonce-([^']+)'/.exec(policy ?? '');
  if (match?.[1] === undefined) throw new Error('no nonce in the policy');
  return match[1];
}

/** Better Auth's session cookie, in HTTP development and CI and, as `__Secure-` below, where the app is HTTPS (#77). */
const SESSION_COOKIE = 'better-auth.session_token';

/** A request from someone holding a session cookie. */
const signedIn = (path: string, cookie = `${SESSION_COOKIE}=a-session-token`) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: { cookie } });
const signedOut = (path: string) => new NextRequest(`http://localhost:3000${path}`);

describe('proxy: the content security policy', () => {
  it('puts a content security policy with a nonce on a page response', () => {
    const response = proxy(signedIn('/'));
    expect(nonceOf(response.headers.get(CSP))).not.toBe('');
  });

  it('also covers the API and anything else, not only pages', () => {
    for (const path of ['/api/health', '/_next/static/chunk.js', '/no/such/page', '/r/abc']) {
      const response = proxy(signedOut(path));
      expect(response.headers.get(CSP), path).toContain("script-src 'self' 'nonce-");
    }
  });

  it('uses a fresh nonce for every request', () => {
    const nonces = new Set(
      Array.from({ length: 50 }, () =>
        nonceOf(proxy(new NextRequest('http://localhost:3000/')).headers.get(CSP)),
      ),
    );
    expect(nonces.size).toBe(50);
  });

  it('gives the page the same policy and nonce, so Next.js stamps its own scripts', () => {
    const response = proxy(signedIn('/'));
    const policy = response.headers.get(CSP);
    expect(response.headers.get(forwarded(CSP))).toBe(policy);
    expect(response.headers.get(forwarded('x-nonce'))).toBe(nonceOf(policy));
  });

  it('ignores a nonce or policy the caller sends in its own request headers', () => {
    const request = new NextRequest('http://localhost:3000/', {
      headers: {
        [CSP]: "script-src 'unsafe-inline'",
        'x-nonce': 'attacker',
        cookie: `${SESSION_COOKIE}=a-session-token`,
      },
    });
    const response = proxy(request);
    expect(response.headers.get(CSP)).not.toContain('unsafe-inline');
    expect(response.headers.get(forwarded('x-nonce'))).not.toBe('attacker');
    expect(response.headers.get(forwarded(CSP))).toBe(response.headers.get(CSP));
  });

  // Behind Caddy the app sees plain http, so the environment decides, not the request's protocol (§14: staging and
  // production are HTTPS only; only a Mac and CI run without TLS).
  describe('upgrade-insecure-requests', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it.each(['staging', 'production'])('is asked for in %s, whatever the protocol', (where) => {
      vi.stubEnv('LZP_ENV', where);
      for (const url of ['http://localhost:3000/', 'https://app.letzeuspost.com/']) {
        expect(proxy(new NextRequest(url)).headers.get(CSP), `${where} ${url}`).toContain(
          'upgrade-insecure-requests',
        );
      }
    });

    it.each(['development', 'ci'])('is left out in %s, even over https', (where) => {
      vi.stubEnv('LZP_ENV', where);
      for (const url of ['http://localhost:3000/', 'https://localhost:3000/']) {
        expect(proxy(new NextRequest(url)).headers.get(CSP), `${where} ${url}`).not.toContain(
          'upgrade-insecure-requests',
        );
      }
    });

    it('is left out when LZP_ENV is not set (the app refuses to start without it anyway)', () => {
      vi.stubEnv('LZP_ENV', '');
      expect(proxy(new NextRequest('http://localhost:3000/')).headers.get(CSP)).not.toContain(
        'upgrade-insecure-requests',
      );
    });
  });
});

// §13: the proxy only redirects, and is never the only check: every page and route checks the session itself. This is
// the optimistic look at the cookie that saves a signed-out visitor a blank page (#78).
describe('proxy: signed out and signed in', () => {
  const location = (response: Response) => response.headers.get('location');

  it.each(['/', '/brands', '/calendar/2026-11', '/settings/members', '/posts/0198b7c2'])(
    'sends a signed-out visitor from the app page %s to /sign-in',
    (path) => {
      const response = proxy(signedOut(path));
      expect(response.status).toBe(307);
      expect(location(response)).toBe('/sign-in');
    },
  );

  it('sends them to /sign-in alone: no host, no query, nothing the request chose', () => {
    for (const path of ['/?next=//evil.example', '/brands?a=b#c', '//evil.example/x']) {
      const request = new NextRequest(`http://localhost:3000${path}`, {
        headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' },
      });
      expect(location(proxy(request)), path).toBe('/sign-in');
    }
  });

  it('keeps the content security policy on the redirect', () => {
    expect(proxy(signedOut('/')).headers.get(CSP)).toContain("script-src 'self' 'nonce-");
  });

  it.each([
    '/sign-in',
    '/sign-in/',
    '/invite/AbCd1234',
    '/r/AbCd1234',
    '/api/health',
    '/api/auth/get-session',
    '/_next/static/chunks/main.js',
    '/favicon.ico',
  ])('lets a signed-out visitor through to %s', (path) => {
    const response = proxy(signedOut(path));
    expect(response.status).toBe(200);
    expect(location(response)).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it.each(['/sign-in-here', '/sign-in.evil', '/invitee', '/invite', '/rabc', '/r', '/apiary'])(
    'does not mistake %s for a public page',
    (path) => {
      expect(location(proxy(signedOut(path)))).toBe('/sign-in');
    },
  );

  it('sends a signed-in visitor away from /sign-in, to the Inbox', () => {
    for (const path of ['/sign-in', '/sign-in/', '/sign-in?error=INVALID_TOKEN']) {
      const response = proxy(signedIn(path));
      expect(response.status, path).toBe(307);
      expect(location(response), path).toBe('/');
    }
  });

  it('lets a signed-in visitor through to app pages and to the public pages other than /sign-in', () => {
    for (const path of ['/', '/brands', '/invite/AbCd1234', '/r/AbCd1234', '/api/health']) {
      const response = proxy(signedIn(path));
      expect(location(response), path).toBeNull();
      expect(response.headers.get('x-middleware-next'), path).toBe('1');
    }
  });

  it('counts the cookie of an HTTPS app (staging, production) as a session too', () => {
    const cookie = `__Secure-${SESSION_COOKIE}=a-session-token`;
    expect(location(proxy(signedIn('/sign-in', cookie)))).toBe('/');
    expect(location(proxy(signedIn('/', cookie)))).toBeNull();
  });

  it.each([
    ['an empty session cookie', `${SESSION_COOKIE}=`],
    ['the session cache cookie alone', 'better-auth.session_data=abc'],
    ['a cookie with a similar name', `x-${SESSION_COOKIE}=abc`],
    ['an unrelated cookie', 'theme=dark; other=1'],
    ['the name as a value', `theme=${SESSION_COOKIE}`],
  ])('does not take %s for a session', (_name, cookie) => {
    expect(location(proxy(signedIn('/', cookie)))).toBe('/sign-in');
    expect(location(proxy(signedIn('/sign-in', cookie)))).toBeNull();
  });
});
